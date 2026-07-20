#!/usr/bin/env python3
"""
mkid — generate a modern unique ID: usr_7k2mfq4x9btz3n

The default generator for new projects. Named after `mkdir` / `mktemp` so it
reads like a native terminal command.

    mkid                        id_7k2mfq4x9btz3n
    mkid --prefix usr           usr_3nq8wt2fkx7mbz
    mkid --prefix usr -n 3
    mkid --uuid7                01936f8a-7c41-7f3e-b8d1-4a9c2e5f0b73
    mkid --in data/records/

    mkid --prefix job --family cus,cou      one stem, several prefixes:
                                              job_7k2mfq4x9btz3n
                                              cus_7k2mfq4x9btz3n
                                              cou_7k2mfq4x9btz3n

Alphabet is Crockford base32 (no i/l/o/u) so IDs survive being read aloud,
handwritten, or retyped without ambiguity.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from idgen import (  # noqa: E402
    DEFAULT_MODERN_LENGTH,
    DEFAULT_MODERN_PREFIX,
    IdGenerationError,
    emit,
    modern_families,
    modern_ids,
    uuid7_ids,
)

VERSION = "1.1.0"


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="mkid",
        description="Generate modern unique IDs.",
        epilog=(
            "Default format is Crockford base32 with a prefix. Use --uuid7 for "
            "time-sortable database keys. For an opaque user ID, "
            "`mkid --prefix usr` is the standard — store it alongside the user "
            "record rather than deriving it from a username."
        ),
    )
    parser.add_argument(
        "-n", "--count", type=int, default=1, metavar="N",
        help="How many IDs to generate (default: 1).",
    )
    parser.add_argument(
        "-p", "--prefix", default=DEFAULT_MODERN_PREFIX, metavar="P",
        help=f"Prefix before the underscore (default: {DEFAULT_MODERN_PREFIX}). "
             f"Pass an empty string for no prefix.",
    )
    parser.add_argument(
        "-l", "--len", dest="length", type=int, default=DEFAULT_MODERN_LENGTH,
        metavar="N",
        help=f"Random body length (default: {DEFAULT_MODERN_LENGTH}).",
    )
    parser.add_argument(
        "-f", "--family", metavar="P1,P2",
        help="Comma-separated sibling prefixes sharing one stem, e.g. "
             "`--prefix job --family cus,cou`. Use when several documents belong "
             "to the same record and should be recognisable as a set.",
    )
    parser.add_argument(
        "--uuid7", action="store_true",
        help="Emit UUIDv7 instead — time-ordered and sortable, for database "
             "primary keys. Ignores --prefix and --len. Note it leaks creation "
             "order, so avoid it where sequence should stay private.",
    )
    parser.add_argument(
        "--in", dest="check_dir", metavar="DIR",
        help="Directory the ID will live in. Existing filenames are treated as "
             "taken and never reissued.",
    )
    parser.add_argument("--version", action="version", version=f"mkid {VERSION}")
    args = parser.parse_args()

    if args.count < 1:
        parser.error("--count must be at least 1")

    if args.family and args.uuid7:
        parser.error("--family and --uuid7 are incompatible (UUIDv7 has no prefix)")
    if args.family and not args.prefix:
        parser.error("--family needs a non-empty --prefix to lead the group")

    try:
        if args.family:
            # Primary prefix first, then siblings in the order given; duplicates
            # dropped so `--prefix job --family job,cus` still behaves.
            prefixes: list[str] = [args.prefix]
            for candidate in args.family.split(","):
                candidate = candidate.strip()
                if candidate and candidate not in prefixes:
                    prefixes.append(candidate)

            families = modern_families(
                count=args.count,
                prefixes=prefixes,
                length=args.length,
                check_dir=args.check_dir,
            )
            for index, group in enumerate(families):
                if index:
                    print()          # blank line separates groups
                emit(group)
        elif args.uuid7:
            emit(uuid7_ids(count=args.count))
        else:
            emit(
                modern_ids(
                    count=args.count,
                    prefix=args.prefix,
                    length=args.length,
                    check_dir=args.check_dir,
                )
            )
    except IdGenerationError as exc:
        print(f"mkid: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
