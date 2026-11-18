#!/usr/bin/env python3
"""Initialize a private workspace and optionally import a resume."""
import argparse
import shutil
from pathlib import Path

from store import ROOT, WORKSPACE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", type=Path, help="Copy a resume into the private workspace.")
    args = parser.parse_args()
    WORKSPACE.mkdir(mode=0o700, exist_ok=True)
    for name in ("resume", "packages", "imports"):
        (WORKSPACE / name).mkdir(exist_ok=True)
    for name in ("profile.md", "experience-bank.md", "project-bank.md", "tags-taxonomy.md", "application-answers.md"):
        dest = WORKSPACE / name
        if not dest.exists():
            shutil.copyfile(ROOT / "templates" / name, dest)
    for name in ("jobs", "contacts", "activity", "sources"):
        name = f"{name}.json"
        path = WORKSPACE / name
        if not path.exists():
            path.write_text("[]\n", encoding="utf-8")
    profile = WORKSPACE / "profile.json"
    if not profile.exists():
        profile.write_text("{}\n", encoding="utf-8")
    if args.resume:
        source = args.resume.expanduser()
        dest = WORKSPACE / "resume" / source.name
        if not source.is_file():
            parser.error("Resume file does not exist.")
        if not dest.exists():
            shutil.copyfile(source, dest)
        else:
            print(f"Existing file kept: {dest.name}")
    print(f"Workspace ready: {WORKSPACE}")
    print("Run python3 scripts/dashboard.py and open Workspace to set your preferences.")


if __name__ == "__main__":
    main()
