"""Shared storage and application state for the dashboard and CLI."""
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT / "workspace"
STATUSES = {
    "not_applied": "NOT SUBMITTED", "submitted": "SUBMITTED", "screen": "SCREEN",
    "assessment": "ASSESSMENT", "interview": "INTERVIEW", "offer": "OFFER",
    "rejected": "REJECTED", "withdrawn": "WITHDRAWN", "closed": "CLOSED",
    "screened_out": "SCREENED OUT", "action_required": "ACTION REQUIRED",
    "in_progress": "IN PROGRESS", "unclear": "UNCLEAR", "duplicate": "DUPLICATE",
}
ACTUAL_STAGES = {"submitted", "screen", "assessment", "interview", "offer",
                 "rejected", "action_required", "in_progress"}


def read(name):
    return json.loads((WORKSPACE / name).read_text(encoding="utf-8"))


def write(name, value):
    data = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    replace_text(name, data)


def replace_text(name, data):
    fd, filename = tempfile.mkstemp(dir=WORKSPACE, prefix=".write-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(data)
        os.replace(filename, WORKSPACE / name)
    finally:
        Path(filename).unlink(missing_ok=True)


@contextmanager
def transaction():
    lock = WORKSPACE / ".write-lock"
    try:
        lock.mkdir()
    except FileExistsError as exc:
        raise ValueError("Workspace is busy. Reload and retry in a moment.") from exc
    try:
        yield
    finally:
        lock.rmdir()


def log(scope, summary):
    events = read("activity.json")
    events.append({"at": datetime.now(timezone.utc).isoformat(), "scope": scope, "summary": summary})
    write("activity.json", events)


def status_key(value):
    aliases = {label: key for key, label in STATUSES.items()}
    return aliases.get(value, value) if isinstance(value, str) else None


def web_url(value):
    if not isinstance(value, str) or not value:
        return ""
    if any(char.isspace() or ord(char) < 32 for char in value):
        return ""
    try:
        url = urlsplit(value)
        return value if url.scheme in ("http", "https") and url.hostname and not url.username and not url.password else ""
    except ValueError:
        return ""


def display_job(row):
    status = status_key(row.get("status"))
    dates = row.get("stageDates") or {}
    return {
        **row, "role": row["title"], "link": web_url(row.get("url")), "note": row.get("notes", ""),
        "date": row.get("date") or "", "status": status if status in STATUSES else "unclear",
        "stageDates": dates, "actionLink": web_url(row.get("actionLink")),
        "applied": bool(dates.get("applied") or row.get("applied") or status in ACTUAL_STAGES),
    }


def edit_job(data):
    from uuid import uuid4
    from dedup import find_matches

    fields = {"company", "title", "url", "notes", "location", "term", "cycle", "pay",
              "action", "actionLink", "resumePath", "source", "ats", "tailorMode",
              "waasPitch", "deadline", "eligibility"}
    with transaction():
        jobs = read("jobs.json")
        key = data.get("id")
        current = next((row for row in jobs if row["id"] == key), None)
        if key is not None and current is None:
            raise ValueError("Job no longer exists.")
        if current is not None and data.get("expected") != current.get("updatedAt"):
            raise ValueError("Job changed since it was opened. Reload and retry.")
        today = date.today().isoformat()
        job = dict(current or {"id": str(uuid4()), "date": today, "status": "NOT SUBMITTED"})
        for field in fields & data.keys():
            value = data[field]
            if not isinstance(value, str) or len(value) > 10000:
                raise ValueError(f"Invalid {field}.")
            job[field] = value.strip()
        for field in ("company", "title"):
            if not job.get(field):
                raise ValueError("Company and role are required.")
        for field in ("url", "actionLink"):
            if job.get(field) and not web_url(job[field]):
                raise ValueError(f"{field} must be a valid HTTP or HTTPS address.")
        if job.get("deadline"):
            date.fromisoformat(job["deadline"])
        if "urgent" in data:
            if not isinstance(data["urgent"], bool):
                raise ValueError("Urgent must be a boolean.")
            job["urgent"] = data["urgent"]
        status = status_key(data.get("status", job["status"]))
        if status not in STATUSES:
            raise ValueError("Choose a valid application status.")
        job["status"] = STATUSES[status]
        dates = dict(job.get("stageDates") or {})
        if status in ACTUAL_STAGES:
            dates.setdefault("applied", today)
        if status in {"screen", "assessment", "interview", "offer", "rejected"}:
            dates.setdefault(status, today)
        job["stageDates"] = dates
        if current is None or any(job.get(field) != current.get(field) for field in ("company", "title", "url", "cycle", "location")):
            matches = find_matches([row for row in jobs if row["id"] != job["id"]], job)
            if matches:
                raise ValueError("Possible duplicate. Review the existing job and add a distinct cycle if applicable.")
        job["updatedAt"] = datetime.now(timezone.utc).isoformat()
        job.setdefault("url", "")
        job.setdefault("notes", "")
        if current is None:
            jobs.append(job)
        else:
            jobs[jobs.index(current)] = job
        write("jobs.json", jobs)
        log("applications", "Job added" if current is None else "Job updated")
    return display_job(job)
