#!/usr/bin/env python3
"""Save a verified posting and tailored resume under one tracked requisition."""
import argparse
import json
import re
import shutil
from pathlib import Path
from uuid import uuid4

from store import WORKSPACE, edit_job, read
from validate_resume import validate


def package(args):
    job = json.loads(args.job.read_text(encoding="utf-8"))
    if not isinstance(job, dict) or not job.get("url"):
        raise ValueError("Provide a JSON job object with company, title and a real posting URL.")
    posting = args.posting.read_text(encoding="utf-8").strip()
    if not posting:
        raise ValueError("Include the actual posting or a verified role summary.")
    pdf = validate(args.resume.resolve(), args.pages, args.strict)
    slug = re.sub(r"[^a-z0-9]+", "-", str(job.get("company", "")).lower()).strip("-") or "company"
    package_dir = WORKSPACE / "packages" / slug[:60] / uuid4().hex[:12]
    package_dir.mkdir(parents=True, exist_ok=False)
    try:
        (package_dir / "posting.md").write_text(job["url"] + "\n\n" + posting + "\n", encoding="utf-8")
        dest = package_dir / "resume.pdf"
        shutil.copyfile(pdf, dest)
        if args.resume.suffix.lower() == ".tex":
            shutil.copyfile(args.resume, package_dir / "resume.tex")
        for document in args.extra:
            if document.name in {"resume.pdf", "resume.tex", "posting.md"} or (package_dir / document.name).exists():
                raise ValueError("Extra documents must have unique file names.")
            shutil.copyfile(document, package_dir / document.name)
        job["resumePath"] = dest.relative_to(WORKSPACE).as_posix()
        job["tailorMode"] = "hypertailored" if args.strict else "tailored"
        job.pop("status", None)
        if args.existing:
            current = next((row for row in read("jobs.json") if row["id"] == args.existing), None)
            if current is None:
                raise ValueError("Existing job ID was not found.")
            # Link the package without rewriting the existing requisition or status.
            job = {**{field: job[field] for field in ("resumePath", "tailorMode")},
                   "id": current["id"], "expected": current.get("updatedAt")}
        else:
            job.pop("id", None)
        tracked = edit_job(job)
    except (ValueError, OSError, TypeError, KeyError):
        # If a disk failure happened after the tracker was written, preserve the linked files.
        rows = read("jobs.json")
        if not any(row.get("resumePath") == (package_dir / "resume.pdf").relative_to(WORKSPACE).as_posix() for row in rows):
            shutil.rmtree(package_dir)
        raise
    return tracked["id"], package_dir


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path, help="JSON object for the specific requisition.")
    parser.add_argument("posting", type=Path, help="Verified posting text in Markdown.")
    parser.add_argument("resume", type=Path, help="Tailored PDF or trusted LaTeX source.")
    parser.add_argument("--extra", action="append", type=Path, default=[], help="Include cover letter or other private artifact.")
    parser.add_argument("--existing", help="Attach to this existing tracker ID; preserve its status.")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--pages", type=int, default=1)
    args = parser.parse_args()
    try:
        job_id, directory = package(args)
        print(f"Tracked as {job_id}\n{directory}")
    except (ValueError, OSError, TypeError, KeyError) as exc:
        parser.exit(1, f"{exc}\n")
