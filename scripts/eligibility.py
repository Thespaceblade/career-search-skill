#!/usr/bin/env python3
"""Compare a posting's explicit graduation window with a configured date."""
import argparse
import re
from datetime import date
from pathlib import Path

from store import read

MONTHS = {name: index for index, name in enumerate(
    "january february march april may june july august september october november december".split(), 1)}
MONTHS.update({name[:3]: index for name, index in list(MONTHS.items())})
SEASONS = {"spring": (3, 5), "summer": (6, 8), "fall": (9, 11), "autumn": (9, 11)}
DATES = "|".join(sorted({*MONTHS, *SEASONS, "winter", "class of"}, key=len, reverse=True))
DATE_TOKEN = re.compile(rf"\b({DATES})\.?\s+(20\d{{2}})\b", re.I)
CONTEXT = re.compile(r"\b(?:graduat\w*|class of|degree completion date)\b", re.I)


def bounds(match):
    token, year = match[1].lower(), int(match[2])
    if token == "winter":
        return (year - 1) * 12 + 12, year * 12 + 2
    if token == "class of":
        return year * 12 + 1, year * 12 + 12
    low, high = SEASONS.get(token, (MONTHS.get(token), MONTHS.get(token)))
    return year * 12 + low, year * 12 + high


def screen(text, graduation):
    if not graduation:
        return "unknown", "No graduation date configured."
    target = date.fromisoformat(graduation + "-01" if len(graduation) == 7 else graduation)
    month = target.year * 12 + target.month
    windows = []
    for line in re.split(r"\n|(?<=[!?;])\s+|(?<=\d{4}\.)\s+", text):
        context = CONTEXT.search(line)
        if not context:
            continue
        # Discard dates that precede the requirement unless the line explicitly leads with a class.
        region = line[context.start():]
        tokens = list(DATE_TOKEN.finditer(region))
        if not tokens:
            continue
        if len(tokens) == 2 and re.fullmatch(r"\s*(?:and|to|through|until|[-–—])\s*",
                                             region[tokens[0].end():tokens[1].start()], re.I):
            windows.append((bounds(tokens[0])[0], bounds(tokens[1])[1], region.strip()))
        elif len(tokens) > 1 and re.fullmatch(
                r"[\s,]*(?:or|/|,)[\s,]*", region[tokens[0].end():tokens[1].start()], re.I):
            if len(tokens) == 2:
                windows.extend((*bounds(token), region.strip()) for token in tokens)
            else:
                return "unknown", "Multiple graduation dates need review."
        elif len(tokens) == 1:
            token = tokens[0]
            lower, upper = bounds(token)
            prefix = region[:token.start()].strip()
            suffix = region[token.end():]
            if re.search(r"\b(?:by|through|no later than)\s*$", prefix, re.I):
                lower = 0
            elif re.search(r"\b(?:on or after|(?:no )?earlier than|starting)\s*$", prefix, re.I) or re.match(r"\s+or later\b", suffix, re.I):
                upper = 2100 * 12
            elif re.search(r"\b(?:before|after|between|until)\b", prefix, re.I):
                return "unknown", "Review the exact graduation wording."
            windows.append((lower, upper, region.strip()))
    if len({label for _, _, label in windows}) > 1:
        return "unknown", "Multiple graduation clauses need review."
    if not windows:
        return "unknown", "No explicit graduation window found."
    if any(low <= month <= high for low, high, _ in windows):
        return "keep", windows[0][2]
    return "review", windows[0][2]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("posting", type=Path)
    parser.add_argument("--graduation", help="YYYY-MM or YYYY-MM-DD. Defaults to private profile.")
    args = parser.parse_args()
    decision, evidence = screen(args.posting.read_text(encoding="utf-8"), args.graduation or read("profile.json").get("graduation"))
    print(f"{decision}: {evidence}")
