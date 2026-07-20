#!/usr/bin/env python3
"""
entry — create a new record from a project's template, with a fresh unique ID.

One global command; each repo describes its own behaviour in
`<repo>/.agents/entry.json`. Run it from anywhere inside the repo:

    entry                     # default type
    entry --type collection
    entry -n 3                # three at once
    entry --dry-run

WHY IT IS BUILT THIS WAY
    `new_job.py` (freelance-payments) and `new_project.py` (360-design) were
    ~90% identical — same template load, same ID stamp, same write — differing
    only in paths, ID regex, and a few prefix rules. Both were reached through
    a ~/bin symlink pointing into their own repo, which made a global command
    depend on one repo sitting at one path.

    ~/bin is a single flat namespace, so a command cannot mean different things
    in different repos. What *is* per-project is the data it operates on. So the
    command lives in the scripts repo and the data lives in the project repo —
    the same split `gate` already uses with `.agents/GATE_NOTES.md`.

CONFIG — <repo>/.agents/entry.json

    {
      "template_dir": "assets/docs",
      "output_dir":   "assets/docs",
      "id_format":    "legacy",          // "legacy" (uid-abc-123) or "modern"
      "id_prefix":    "id",              // modern only
      "indent":       4,
      "default_type": "entry",
      "types": {
        "entry":      { "template": "_entry_template.json" },
        "collection": { "template": "_collection_template.json",
                        "middle": "col" }    // rewrite the legacy middle segment
      },
      "stamp": { "id": "{id}" }          // dotted JSON paths -> value templates
    }

    Stamp paths use dots for keys and integers for list indices:
    "price1.product.products.0". Values may reference "{id}", or a
    prefix-swapped variant via "{id:cus-}" which replaces the leading "uid-".
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "uid"))

from idgen import IdGenerationError, legacy_ids, modern_ids  # noqa: E402

VERSION = "1.0.0"

CONFIG_RELATIVE = Path(".agents") / "entry.json"


class EntryError(RuntimeError):
    """Anything that should stop the run with a readable message."""


# ── Locating the project ─────────────────────────────────────────────────────


def find_repo_root(start: Path) -> Path:
    """Walk up until a .git directory turns up."""
    for candidate in [start, *start.parents]:
        if (candidate / ".git").exists():
            return candidate
    raise EntryError(
        f"Not inside a git repository (looked upward from {start}). "
        f"entry resolves its config from the repo root."
    )


def load_config(repo_root: Path) -> dict:
    path = repo_root / CONFIG_RELATIVE
    if not path.exists():
        raise EntryError(
            f"No config at {path}\n"
            f"Create it to describe this project's templates and output "
            f"directory — see the example in "
            f"~/Development/scripts/entry/entry.example.json"
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EntryError(f"Config is not valid JSON: {path}\n  {exc}") from exc


# ── ID generation ────────────────────────────────────────────────────────────


def make_ids(config: dict, count: int, output_dir: Path) -> list[str]:
    """Generate IDs, always checked against the directory they will live in."""
    id_format = config.get("id_format", "modern")
    check = str(output_dir) if output_dir.is_dir() else None

    if id_format == "legacy":
        return legacy_ids(count=count, check_dir=check)
    if id_format == "modern":
        return modern_ids(
            count=count,
            prefix=config.get("id_prefix", "id"),
            length=config.get("id_length", 14),
            check_dir=check,
        )
    raise EntryError(f"Unknown id_format: {id_format!r} (expected 'legacy' or 'modern')")


def apply_middle(record_id: str, middle: str | None) -> str:
    """
    Rewrite the middle segment of a legacy ID, e.g. uid-rfr-187 -> uid-col-187.

    Used for type-specific schemes; the numeric tail is what stays unique.
    """
    if not middle:
        return record_id
    swapped, n = re.subn(r"^uid-[a-z]{3}-([0-9]{3})$", rf"uid-{middle}-\1", record_id)
    if n == 0:
        raise EntryError(
            f"Cannot apply middle segment {middle!r} to {record_id!r} — "
            f"'middle' only applies to legacy uid-abc-123 IDs."
        )
    return swapped


def render_value(template: str, record_id: str) -> str:
    """
    Expand {id} and {id:<prefix>} in a stamp value.

    {id:cus-} yields the ID with its leading "uid-" replaced by "cus-", which is
    how freelance-payments derives sibling customer and coupon IDs.
    """
    def substitute(match: re.Match) -> str:
        prefix = match.group(1)
        if not prefix:
            return record_id
        return re.sub(r"^[a-z]+-", prefix, record_id, count=1)

    return re.sub(r"\{id(?::([^}]+))?\}", substitute, template)


# ── Stamping ─────────────────────────────────────────────────────────────────


def set_path(data: Any, dotted: str, value: Any) -> None:
    """Assign into nested dicts/lists by dotted path; integers index lists."""
    parts = dotted.split(".")
    cursor = data
    for part in parts[:-1]:
        key: Any = int(part) if part.isdigit() else part
        try:
            cursor = cursor[key]
        except (KeyError, IndexError, TypeError) as exc:
            raise EntryError(f"Stamp path '{dotted}' does not exist in the template") from exc

    last: Any = int(parts[-1]) if parts[-1].isdigit() else parts[-1]
    try:
        cursor[last] = value
    except (IndexError, TypeError) as exc:
        raise EntryError(f"Stamp path '{dotted}' is not assignable in the template") from exc


def stamp(data: dict, stamps: dict, record_id: str) -> dict:
    for dotted, template in stamps.items():
        set_path(data, dotted, render_value(str(template), record_id))
    return data


# ── Main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="entry",
        description="Create a new record from this project's template, with a unique ID.",
        epilog="Reads .agents/entry.json from the repo root.",
    )
    parser.add_argument("--type", "-t", dest="type_name", help="Record type (see config).")
    parser.add_argument("-n", "--count", type=int, default=1, help="How many to create (default: 1).")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be created, write nothing.")
    parser.add_argument("--version", action="version", version=f"entry {VERSION}")
    args = parser.parse_args()

    if args.count < 1:
        parser.error("--count must be at least 1")

    repo_root = find_repo_root(Path.cwd().resolve())
    config = load_config(repo_root)

    types = config.get("types") or {}
    if not types:
        raise EntryError("Config defines no 'types'.")

    type_name = args.type_name or config.get("default_type") or next(iter(types))
    if type_name not in types:
        raise EntryError(
            f"Unknown type {type_name!r}. Available: {', '.join(sorted(types))}"
        )
    type_config = types[type_name]

    template_dir = repo_root / config.get("template_dir", ".")
    output_dir = repo_root / config.get("output_dir", ".")
    template_path = template_dir / type_config["template"]

    if not template_path.exists():
        raise EntryError(f"Template not found: {template_path}")

    ids = make_ids(config, args.count, output_dir)
    ids = [apply_middle(i, type_config.get("middle")) for i in ids]

    indent = config.get("indent", 2)
    stamps = config.get("stamp") or {}
    created: list[Path] = []

    for record_id in ids:
        data = json.loads(template_path.read_text(encoding="utf-8"))
        data = stamp(data, stamps, record_id)
        out_path = output_dir / f"{record_id}.json"

        if out_path.exists():
            raise EntryError(f"Refusing to overwrite existing file: {out_path}")

        if not args.dry_run:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(
                json.dumps(data, indent=indent, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        created.append(out_path)

    label = "Would create" if args.dry_run else "Created"
    print(f"{label} {len(created)} {type_name} file(s):")
    for path in created:
        print(f"  {path.relative_to(repo_root)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (EntryError, IdGenerationError) as exc:
        print(f"entry: {exc}", file=sys.stderr)
        raise SystemExit(1)
