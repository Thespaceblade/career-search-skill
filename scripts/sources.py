#!/usr/bin/env python3
"""Fetch configured job boards and normalize exports into a private review queue."""
import argparse
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import ats_extended_adapters as extended

from dedup import clean, find_matches, identities
from store import WORKSPACE, log, read, transaction, web_url, write

BOARD_URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true",
    "lever": "https://api.lever.co/v0/postings/{}?mode=json&limit=100&skip=",
    "lever-eu": "https://api.eu.lever.co/v0/postings/{}?mode=json&limit=100&skip=",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true",
    "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{}/postings?limit=100&offset=",
}
PAGE_LIMIT = 50
EXTENDED = {
    "eightfold": extended.fetch_eightfold, "jibe": extended.fetch_jibe,
    "oracle": extended.fetch_oracle,
}
ATS_KINDS = {*BOARD_URLS, *EXTENDED, "workday"}
INTERNSHIP = re.compile(r"\bintern(?:ship)?s?\b|\bco[- ]?op\b", re.I)


def request_json(url, timeout=20, data=None):
    if not web_url(url) or not url.startswith("https://"):
        raise ValueError("A public HTTPS feed URL is required.")
    headers = {"User-Agent": "CareerSearchSkill/1.0"}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    with urlopen(Request(url, headers=headers, data=body), timeout=timeout) as response:
        if not response.url.startswith("https://"):
            raise ValueError("Feed redirected away from HTTPS.")
        content = response.read(16_000_001)
    if len(content) > 16_000_000:
        raise ValueError("Feed exceeds 16 MB.")
    return json.loads(content)


def text(item, *keys):
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def normalize(item, source):
    kind = source["kind"]
    link = text(item, "url", "absolute_url", "hostedUrl", "jobUrl", "applyUrl", "ref")
    if kind == "smartrecruiters":
        slug = str(item.get("id", ""))
        if re.fullmatch(r"[\w-]+", slug, re.ASCII):
            link = f"https://jobs.smartrecruiters.com/{source['board']}/{slug}"
    if not web_url(link):
        return None
    if item.get("active") is False or item.get("isListed") is False:
        return None
    location = item.get("location", (item.get("categories") or {}).get("location", ""))
    if isinstance(location, dict):
        location = text(location, "name", "city", "region")
    if not location and isinstance(item.get("locations"), list):
        location = ", ".join(value for value in item["locations"] if isinstance(value, str))
    if not isinstance(location, str):
        location = ""
    row = {
        "company": source.get("company") or text(item, "company", "company_name", "employer"),
        "title": text(item, "title", "text", "name", "role"), "url": link, "location": location or "",
        "cycle": text(item, "cycle") or source.get("cycle", ""),
        "source": "direct" if kind in ATS_KINDS else source.get("label", kind),
        "ats": kind if kind in ATS_KINDS else text(item, "ats"),
        "description": text(item, "descriptionPlain", "description", "content")[:25000],
        "pay": text(item, "pay") or text(item.get("compensation") or {}, "compensationTierSummary"),
    }
    return row if row["title"] and row["company"] else None


def fetch(source):
    kind = source["kind"]
    if kind in {"csv", "json", "xlsx"} and "path" in source:
        base = (WORKSPACE / "imports").resolve()
        path = (base / source["path"]).resolve()
        if base not in path.parents:
            raise ValueError("Import files must be under workspace/imports.")
        if kind == "csv":
            with path.open(encoding="utf-8-sig", newline="") as handle:
                return list(csv.DictReader(handle))
        if kind == "xlsx":
            return read_xlsx(path, source)
        return json.loads(path.read_text(encoding="utf-8"))
    if kind in {"simplify", "json"}:
        return request_json(source["url"])
    if kind in EXTENDED:
        return EXTENDED[kind](source, request_json, INTERNSHIP)["jobs"]
    if kind == "workday":
        return fetch_workday(source)
    if kind not in BOARD_URLS:
        raise ValueError(f"Unknown source kind: {kind}")
    board = source["board"]
    if not re.fullmatch(r"[\w-]+", board, re.ASCII):
        raise ValueError("Use a board slug, not a URL.")
    url = BOARD_URLS[kind].format(board)
    if kind in {"greenhouse", "ashby"}:
        return request_json(url)["jobs"]
    out = []
    seen = set()
    for page in range(PAGE_LIMIT):
        payload = request_json(url + str(page * 100))
        results = payload["content"] if kind == "smartrecruiters" else payload
        ids = {row["id"] for row in results}
        if ids & seen:
            raise ValueError("Board repeated postings during pagination.")
        seen.update(ids)
        out.extend(results)
        if len(results) < 100:
            return out
    raise ValueError("Board hit the pagination limit. Review its coverage manually.")


def fetch_workday(source):
    host, tenant, site = (source[key] for key in ("host", "tenant", "site"))
    if not re.fullmatch(r"[a-z0-9.-]+\.myworkday(?:jobs|site)\.com", host, re.I):
        raise ValueError("Expected a public Workday careers hostname.")
    if not all(re.fullmatch(r"[\w-]+", value, re.ASCII) for value in (tenant, site)):
        raise ValueError("Expected Workday tenant and site slugs.")
    base = f"https://{host}"
    endpoint = f"{base}/wday/cxs/{tenant}/{site}/jobs"
    query = {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": source.get("query", "")}
    out = {}
    received = 0
    for page in range(PAGE_LIMIT):
        query["offset"] = page * 20
        payload = request_json(endpoint, data=query)
        total = int(payload["total"])
        if total > PAGE_LIMIT * 20:
            raise ValueError("Workday search is too broad. Configure a narrower query.")
        postings = payload["jobPostings"]
        received += len(postings)
        for posting in postings:
            external = posting.get("externalPath", "")
            if not external.startswith("/job/") or not posting.get("title"):
                continue
            if external in out:
                raise ValueError("Workday repeated postings during pagination.")
            out[external] = {"title": posting["title"], "location": posting.get("locationsText", ""),
                             "url": f"{base}/{site}{external}"}
        if received >= total:
            return list(out.values())
        if not postings:
            break
    raise ValueError("Workday listing was incomplete.")



def read_xlsx(path, source):
    try:
        import openpyxl
    except ImportError as exc:
        raise ValueError("Install openpyxl to import .xlsx, or export to CSV.") from exc
    book = openpyxl.load_workbook(path, data_only=True)
    try:
        sheet = book[source["sheet"]] if source.get("sheet") else book.active
        header = int(source.get("header_row", 1))
        names = [str(cell.value or "").strip().lower() for cell in sheet[header]]
        columns = source.get("columns", {})
        rows = []
        for cells in sheet.iter_rows(min_row=header + 1):
            row = {}
            for name, cell in zip(names, cells):
                field = columns.get(name, name)
                row[field] = str((cell.hyperlink.target if field == "url" and cell.hyperlink else cell.value) or "")
            rows.append(row)
        return rows
    finally:
        book.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--match", help="Case-insensitive regular expression for role titles.")
    args = parser.parse_args()
    try:
        matcher = re.compile(args.match, re.I) if args.match else None
    except re.error as exc:
        parser.error(str(exc))
    tracked = read("jobs.json")
    index = {}
    def keys(row):
        return identities(row) | {("title", *(clean(row.get(field)) for field in ("company", "title", "location")))}

    def add_to_index(row, scope):
        for key in keys(row):
            index.setdefault((scope, key), []).append(row)

    def matches_in(row, scope):
        possible = {id(match): match for key in keys(row) for match in index.get((scope, key), ())}
        return find_matches(possible.values(), row)

    for row in tracked:
        add_to_index(row, "tracked")
    found, problems = [], []
    for source in read("sources.json"):
        label = source.get("company") or source.get("kind", "Unknown")
        try:
            for item in fetch(source):
                if not isinstance(item, dict):
                    continue
                row = normalize(item, source)
                if not row or (matcher and not matcher.search(row["title"])):
                    continue
                if matches_in(row, "tracked"):
                    continue
                matches = matches_in(row, "found")
                if not matches:
                    row["sources"] = [row["source"]]
                    found.append(row)
                    add_to_index(row, "found")
                elif row["source"] not in matches[0]["sources"]:
                    matches[0]["sources"].append(row["source"])
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            code = f"HTTP {error.code}" if isinstance(error, HTTPError) else type(error).__name__
            problems.append(f"{label}: {code} ({error})")
    with transaction():
        write("discovery.json", {"checked": datetime.now(timezone.utc).isoformat(),
                                 "candidates": found, "errors": problems})
        log("discovery", f"{len(found)} candidates for review, {len(problems)} source errors")
    print(f"{len(found)} candidates in workspace/discovery.json. {len(problems)} source errors.")
    return bool(problems)


if __name__ == "__main__":
    raise SystemExit(main())
