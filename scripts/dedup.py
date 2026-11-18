"""Stable ATS identities and conservative duplicate checks."""
import re
from urllib.parse import parse_qsl, urlencode, urlsplit

UUID_RE = r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

def normalize_job_id(url):
    if not url:
        return (None, None)
    url = url.strip().rstrip('.,)')

    m = re.search(r'[?&]gh_jid=(\d+)', url)
    if m:
        return ('greenhouse', m.group(1))
    m = re.search(r'greenhouse\.io/[^/?#]+/jobs/(\d+)', url)
    if m:
        return ('greenhouse', m.group(1))

    m = re.search(r'lever\.co/[^/]+/(' + UUID_RE + ')', url)
    if m:
        return ('lever', m.group(1).lower())

    m = re.search(r'ashbyhq\.com/[^/]+/(' + UUID_RE + ')', url)
    if m:
        return ('ashby', m.group(1).lower())

    m = re.search(r'simplify\.jobs/p/(' + UUID_RE + ')', url)
    if m:
        return ('simplify', m.group(1).lower())

    if 'simplify.jobs/c/' in url:
        return (None, None)

    if 'myworkdayjobs.com' in url or 'myworkdaysite.com' in url or '/wday/' in url:
        m = re.search(r'(?:_|/)((?:JR|R)[-_]?\d{4,})(?:/?(?:[?#]|$))', url, re.I)
        if m:
            return ('workday', re.sub(r'[-_]', '', m.group(1)).upper())
        m = re.search(r'((?:JR|R)[-_]?\d{4,})$', urlsplit(url).path.rstrip('/'), re.I)
        if m:
            return ('workday', re.sub(r'[-_]', '', m.group(1)).upper())

    return (None, None)


def extract_all_ids_from_url(url):
    if not url:
        return set()
    url = url.strip().rstrip('.,)')
    ids = set()

    t, i = normalize_job_id(url)
    if t:
        if t != 'workday':
            ids.add((t, i))

    m = re.search(r'https?://([^/]+)/jobs/(\d+)(?:[/?#]|$)', url)
    if m:
        domain = m.group(1).lower()
        if domain not in ('boards.greenhouse.io', 'job-boards.greenhouse.io'):
            ids.add(('customjobs:' + domain, m.group(2)))

    m = re.search(r'https?://([^/]+\.oraclecloud\.com)/.*?/job/(\d+)(?:[/?#]|$)', url)
    if m:
        ids.add(('oraclecloud:' + m.group(1).lower(), m.group(2)))

    host_m = re.search(r'https?://([^/]+\.myworkday(?:jobs|site)\.com)/', url, re.I)
    if host_m:
        host = host_m.group(1).lower()
        path = urlsplit(url).path
        m = re.search(r'_((?:JR|R)[-_]?\d{4,}(?:-\d+)?)(?:/?(?:[?#]|$))', path, re.I)
        if m:
            req = re.sub(r'[-_]', '', m.group(1)).upper()
            ids.add(('workday:' + host, req))
            base = re.sub(r'-1$', '', req)
            if base != req:
                ids.add(('workday:' + host, base))
        else:
            m = re.search(r'_(\d{5,}(?:-\d+)?)(?:/?(?:[?#]|$))', path)
            if m:
                req = m.group(1).upper()
                ids.add(('workday:' + host, req))
                base = re.sub(r'-1$', '', req)
                if base != req:
                    ids.add(('workday:' + host, base))

    m = re.search(r'smartrecruiters\.com/([^/]+)/(\d+)', url)
    if m:
        ids.add(('smartrecruiters:' + m.group(1).lower(), m.group(2)))

    m = re.search(r'tesla\.com/careers/search/job/(\d+)', url)
    if m:
        ids.add(('tesla', m.group(1)))

    m = re.search(r'workable\.com/([^/]+)/j/([A-Za-z0-9]+)', url)
    if m:
        ids.add(('workable:' + m.group(1).lower(), m.group(2).upper()))

    m = re.search(r'ats\.rippling\.com/([^/]+)/jobs/(' + UUID_RE + ')', url)
    if m:
        ids.add(('rippling:' + m.group(1).lower(), m.group(2).lower()))

    m = re.search(r'amazon\.jobs/[^/]+/jobs/(\d+)', url)
    if m:
        ids.add(('amazon', m.group(1)))

    return ids



def canonical_url(url):
    if not url:
        return ""
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query)
             if not key.startswith("utm_") and key not in {"ref", "source", "gh_src", "fbclid", "gclid"}]
    path = parts.path.rstrip("/")
    if not path or parts.hostname == "simplify.jobs" and path.startswith("/c/"):
        return ""
    return f"{parts.netloc.lower()}{path}?{urlencode(sorted(query))}"


def identities(row):
    urls = [row.get("url") or "", *(row.get("aliases") or [])]
    keys = set()
    for url in urls:
        if url:
            keys.update(extract_all_ids_from_url(url))
            normalized = canonical_url(url)
            if normalized:
                keys.add(("url", normalized))
    return keys


def clean(value):
    return " ".join(str(value or "").casefold().split())


def find_matches(rows, candidate):
    result = []
    candidate_keys = identities(candidate)
    for row in rows:
        cycle, other = clean(candidate.get("cycle")), clean(row.get("cycle"))
        if cycle and other and cycle != other:
            continue
        if candidate_keys & identities(row):
            result.append(row)
            continue
        fields = ("company", "title", "location")
        if candidate_keys and identities(row):
            continue
        if all(clean(candidate.get(field)) == clean(row.get(field)) for field in fields):
            result.append(row)
    return result


if __name__ == "__main__":
    import argparse
    import json
    from store import read

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--cycle", default="")
    args = parser.parse_args()
    print(json.dumps(find_matches(read("jobs.json"), {"url": args.url, "cycle": args.cycle}), indent=2))
