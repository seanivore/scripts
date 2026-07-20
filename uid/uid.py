#!/usr/bin/env python3
"""
uid — generate a legacy-format unique ID: uid-abc-123

For the repos that already have this format baked into their filenames and
templates (360-design, freelance-payments). For anything new, use `mkid`.

Prints the bare ID on stdout, one per line, so it composes:

    ID=$(uid)
    uid -n 5
    uid --in assets/docs/
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from idgen import VERSION, IdGenerationError, emit, legacy_ids  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="uid",
        description="Generate legacy-format unique IDs (uid-abc-123).",
        epilog=(
            "Namespace is 26^3 x 1000 (~17.5M). Pass --in to check against a "
            "directory for a hard uniqueness guarantee. New projects should "
            "use `mkid` instead."
        ),
    )
    parser.add_argument(
        "-n", "--count", type=int, default=1, metavar="N",
        help="How many IDs to generate (default: 1).",
    )
    parser.add_argument(
        "--in", dest="check_dir", metavar="DIR",
        help="Directory the ID will live in. Existing filenames are treated as "
             "taken and never reissued.",
    )
    parser.add_argument("--version", action="version", version=f"uid {VERSION}")
    args = parser.parse_args()

    if args.count < 1:
        parser.error("--count must be at least 1")

    try:
        emit(legacy_ids(count=args.count, check_dir=args.check_dir))
    except IdGenerationError as exc:
        print(f"uid: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
