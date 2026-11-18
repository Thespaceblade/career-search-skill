#!/usr/bin/env python3
"""Compile a trusted LaTeX resume or inspect an existing PDF for ATS basics."""
import argparse
import re
import shutil
import subprocess
from pathlib import Path


def run(args, cwd=None):
    if not shutil.which(args[0]):
        raise ValueError(f"{args[0]} is required. Install a TeX distribution and Poppler.")
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise ValueError(f"{args[0]} failed:\n{(result.stdout + result.stderr)[-2200:]}")
    return result.stdout


def validate(source, pages, strict):
    if not source.is_file():
        raise ValueError("Resume file does not exist.")
    pdf = source
    if source.suffix.lower() == ".tex":
        tex = source.read_text(encoding="utf-8")
        if strict:
            bullets = re.findall(r"\\resumeItem\{([^\n]+)\}", tex)
            if not bullets or any(not re.search(r"\d", bullet) for bullet in bullets):
                raise ValueError("Strict tailoring requires a confirmed number in each resumeItem bullet.")
        for _ in range(2):
            run(["pdflatex", "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "./" + source.name], cwd=source.parent)
        pdf = source.with_suffix(".pdf")
    elif source.suffix.lower() != ".pdf":
        raise ValueError("Use a .tex or .pdf file.")
    info = run(["pdfinfo", str(pdf)])
    count = re.search(r"^Pages:\s+(\d+)", info, re.M)
    if not count or int(count[1]) != pages:
        raise ValueError(f"Expected {pages} page(s), found {count[1] if count else 'unknown'}.")
    extracted = run(["pdftotext", "-layout", str(pdf), "-"])
    if len(extracted.strip()) < 100 or "\ufffd" in extracted:
        raise ValueError("PDF does not extract to usable text.")
    if re.search(r"YOUR NAME|you@example\.com|replace this bullet|your contribution", extracted, re.I):
        raise ValueError("Replace all template placeholders.")
    return pdf


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("resume", type=Path)
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--strict", action="store_true", help="For .tex files, check for a number in each template bullet.")
    args = parser.parse_args()
    try:
        pdf = validate(args.resume.resolve(), args.pages, args.strict)
        print(f"Validated {pdf.name}. Inspect the render, dates, links, and evidence before use.")
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        parser.exit(1, f"{exc}\n")
