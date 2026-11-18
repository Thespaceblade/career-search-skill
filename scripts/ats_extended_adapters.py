"""Read-only public-careers adapters. Never authenticate or submit applications.

Pagination is validated; capped/repeated/missing pages fail rather than becoming
a completed baseline. Only job records are retained, never candidate/session data.
"""
import concurrent.futures as cf
from urllib.parse import urlencode, urljoin

SEARCH_TERMS = ("intern", "internship", "co-op")


def collect_pages(get_page, rows_key, total_key, id_key, max_results=10000):
    first = get_page(0)
    if rows_key not in first or total_key not in first:
        raise ValueError("Missing pagination fields")
    total = int(first[total_key])
    rows = first[rows_key]
    if total > max_results:
        raise ValueError(f"Partial scan: {total} results exceed safety cap {max_results}")
    if total and not rows:
        raise ValueError("Partial scan: empty first page")
    size = len(rows) or 1
    unique = {str(row[id_key]): row for row in rows}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for page in pool.map(get_page, range(size, total, size)):
            if rows_key not in page:
                raise ValueError("Partial scan: malformed page")
            unique.update({str(row[id_key]): row for row in page[rows_key]})
    if len(unique) < total:
        raise ValueError(f"Partial scan: {len(unique)} distinct records for {total} advertised")
    return list(unique.values()), total


def fetch_eightfold(v, get, intern_title, timeout=30):
    base, domain = v["base_url"].rstrip("/"), v["domain"]
    pcs = v.get("variant") == "pcsx"
    path = "/api/pcsx/search" if pcs else "/api/apply/v2/jobs"
    totals, found = {}, {}
    for term in SEARCH_TERMS:
        def page(start):
            response = get(base + path + "?" + urlencode({"domain": domain, "query": term, "start": start, "sort_by": "timestamp"}), timeout=timeout)
            return response.get("data", response) if pcs else response
        rows, total = collect_pages(page, "positions", "count", "id")
        totals[term] = total
        for row in rows:
            if intern_title.search(row.get("name", "")):
                found[str(row["id"])] = row

    def detail(item):
        ident, row = item
        path = ("/api/pcsx/position_details?" + urlencode({"domain": domain, "position_id": ident})) if pcs else (f"/api/apply/v2/jobs/{ident}?" + urlencode({"domain": domain}))
        response = get(base + path, timeout=timeout)
        info = response.get("data", response) if pcs else response
        description = info.get("jobDescription") or info.get("job_description")
        if not description or str(info.get("id")) != ident:
            raise ValueError(f"Missing/mismatched JD for {ident}")
        return {"id": ident, "ats_id": info.get("atsJobId") or info.get("ats_job_id"),
                "title": info.get("name", row["name"]),
                "location": "; ".join(info.get("locations") or row.get("locations") or []),
                "url": info.get("canonicalPositionUrl") or urljoin(base, info.get("positionUrl") or f"/careers/job/{ident}"),
                "description": description}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = list(pool.map(detail, found.items()))
    return {"jobs": jobs, "query_totals": totals, "scan_scope": "intern/internship/co-op searches, all pages and matching JDs", "complete": True}


def fetch_smartrecruiters(v, get, intern_title, timeout=30):
    base = f"https://api.smartrecruiters.com/v1/companies/{v['slug']}/postings"
    rows, total = collect_pages(lambda offset: get(base + "?" + urlencode({"offset": offset, "limit": 100}), timeout=timeout), "content", "totalFound", "id")
    def detail(row):
        info = get(base + "/" + row["id"], timeout=timeout)
        sections = (info.get("jobAd") or {}).get("sections") or {}
        description = "\n".join(x.get("text", "") for x in sections.values())
        if not description:
            raise ValueError(f"Missing JD for {row['id']}")
        loc = info.get("location") or row.get("location") or {}
        return {"id": row["id"], "title": info.get("name", row["name"]),
                "location": loc.get("fullLocation") or ", ".join(str(loc.get(k) or "") for k in ("city", "region", "country")),
                "url": info.get("applyUrl") or f"https://jobs.smartrecruiters.com/{v['slug']}/{row['id']}",
                "description": description}
    matches = [r for r in rows if intern_title.search(r.get("name", "")) or (r.get("typeOfEmployment") or {}).get("id") == "intern"]
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = list(pool.map(detail, matches))
    return {"jobs": jobs, "board_total": total, "scan_scope": "entire board and internship/co-op JDs", "complete": True}


def fetch_jibe(v, get, intern_title, timeout=30):
    base = v['base_url'].rstrip('/')
    def page(offset):
        response = get(base + '/api/jobs?' + urlencode({'page':offset // 100 + 1, 'limit':100}), timeout=timeout)
        if 'jobs' not in response or 'totalCount' not in response:
            raise ValueError('Missing Jibe pagination fields')
        return {'jobs':[row['data'] for row in response['jobs']], 'total':response['totalCount']}
    rows, total = collect_pages(page, 'jobs', 'total', 'slug')
    jobs = []
    for row in rows:
        if not intern_title.search(row.get('title', '')) and row.get('employment_type') != 'INTERN':
            continue
        description = '\n'.join(row.get(k) or '' for k in ('description', 'qualifications', 'responsibilities'))
        if not description:
            raise ValueError(f"Missing JD for {row['slug']}")
        jobs.append({'id':row['slug'], 'title':row['title'],
                     'location':', '.join(row.get(k) or '' for k in ('city','state','country')),
                     'url':row.get('apply_url') or base + '/jobs/' + row['slug'], 'description':description})
    return {'jobs':jobs, 'board_total':total, 'scan_scope':'entire public board with JDs', 'complete':True}


def fetch_oracle(v, get, intern_title, timeout=30):
    base = v['base_url'].rstrip('/') + '/hcmRestApi/resources/latest/'
    found, totals = {}, {}
    # Oracle's broad `intern` keyword search currently matches thousands of
    # unrelated descriptions containing words such as "internal" and makes
    # the result order unstable across pages. The precise `internship` query
    # returns the same live Intern-titled requisitions, while `co-op` covers
    # the alternate program label without the false-positive explosion.
    for term in ('internship', 'co-op'):
        def page(offset):
            finder = f"findReqs;siteNumber={v['site']},keyword={term},limit=100,offset={offset},sortBy=POSTING_DATES_DESC"
            response = get(base + 'recruitingCEJobRequisitions?' + urlencode({'onlyData':'true', 'expand':'requisitionList', 'finder':finder}), timeout=timeout)
            items = response.get('items') or []
            if not items:
                raise ValueError('Missing Oracle search response')
            return items[0]
        rows, total = collect_pages(page, 'requisitionList', 'TotalJobsCount', 'Id', max_results=20000)
        totals[term] = total
        for row in rows:
            if intern_title.search(row.get('Title','')):
                found[row['Id']] = row
    def detail(row):
        response = get(base + 'recruitingCEJobRequisitionDetails?' + urlencode({'onlyData':'true', 'expand':'all', 'finder':f"ById;Id={row['Id']}"}), timeout=timeout)
        items = response.get('items') or []
        if not items or str(items[0].get('Id')) != str(row['Id']):
            raise ValueError(f"Missing Oracle JD {row['Id']}")
        info = items[0]
        description = '\n'.join(info.get(k) or '' for k in ('ExternalDescriptionStr','ExternalQualificationsStr','ExternalResponsibilitiesStr'))
        if not description:
            raise ValueError(f"Empty Oracle JD {row['Id']}")
        return {'id':row['Id'], 'title':row['Title'], 'location':row.get('PrimaryLocation',''),
                'url':v['careers_url'].rstrip('/') + '/job/' + row['Id'], 'description':description}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = list(pool.map(detail, found.values()))
    return {'jobs':jobs, 'query_totals':totals, 'scan_scope':'internship/co-op searches, all pages and matching JDs', 'complete':True}
