#!/usr/bin/env python3
"""Create a local backup of the private workspace at an explicit destination."""
import argparse
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from store import WORKSPACE, transaction

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
destination = args.destination.expanduser().resolve()
if destination == WORKSPACE or WORKSPACE in destination.parents:
    parser.error("Place the backup outside workspace/.")
with transaction():
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle, ZipFile(handle, "w", ZIP_DEFLATED) as archive:
            for base, dirs, files in os.walk(WORKSPACE):
                base = Path(base)
                dirs[:] = [name for name in dirs if not name.startswith(".") and not (base / name).is_symlink()]
                for name in files:
                    path = base / name
                    if not name.startswith(".") and not path.is_symlink():
                        archive.write(path, path.relative_to(WORKSPACE.parent))
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
print(f"Backup saved to {destination}")
