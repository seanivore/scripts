#!/usr/bin/env python3
"""
token — estimate token counts for text, a file, or a whole repo.

For the quick "how big is this before I paste it into a chat" check.

    token "some text"
    token README.md
    token ~/Development/scripts
    token . --json

WHY THE NUMBER IS APPROXIMATE
    There is no offline tokenizer for Claude, so this uses a character-ratio
    estimate (~3.5 chars/token for prose, ~4.0 for code). Expect roughly +/-10%.
    That is accurate enough to answer "will this fit" and is instant, which is
    the point — an exact count would mean a network round trip.

CHANGES FROM THE ~/bin VERSION
    The old copy hard-coded a 7500-token "is_safe" threshold and printed a line
    per file when scanning a directory. Both belonged to a retired workflow that
    needed agents to self-report token budgets. Directory mode now summarises and
    shows the biggest contributors instead, and skips .git / node_modules / venv
    rather than walking them.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

VERSION = "2.0.0"

PROSE_RATIO = 3.5
CODE_RATIO = 4.0

CODE_MARKERS = ("```", "def ", "class ", "function", "var ", "const ", "import ", "#include")

SKIP_DIRS = {
    ".git", "node_modules", "venv", ".venv", "__pycache__", ".next", ".turbo",
    "dist", "build", ".cache", ".pytest_cache", ".mypy_cache", ".ruff_cache",
}

TEXT_SUFFIXES = {
    ".md", ".txt", ".py", ".json", ".sh", ".js", ".ts", ".tsx", ".jsx", ".css",
    ".html", ".yml", ".yaml", ".toml", ".sql", ".rs", ".go", ".rb", ".java",
    ".c", ".h", ".cpp", ".swift", ".kt", ".mjs", ".cjs", ".env", ".cfg", ".ini",
}


def count_text(text: str) -> int:
    """Estimate tokens in a string."""
    if not text.strip():
        return 0
    ratio = CODE_RATIO if any(m in text for m in CODE_MARKERS) else PROSE_RATIO
    return max(1, int(len(text) / ratio))


def count_file(path: Path) -> int:
    try:
        return count_text(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return 0


def count_directory(root: Path) -> tuple[int, list[tuple[str, int]]]:
    """Return (total_tokens, [(relative_path, tokens), ...]) sorted biggest first."""
    files: list[tuple[str, int]] = []
    total = 0

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            path = Path(dirpath) / name
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            tokens = count_file(path)
            if tokens:
                total += tokens
                files.append((str(path.relative_to(root)), tokens))

    files.sort(key=lambda pair: pair[1], reverse=True)
    return total, files


def human(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k"
    return str(n)


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="token",
        description="Estimate token counts for text, a file, or a directory.",
        epilog="Counts are approximate (character-ratio estimate, ~+/-10%).",
    )
    parser.add_argument("target", nargs="+", help="Quoted text, a file path, or a directory.")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Machine-readable output.")
    parser.add_argument("--top", type=int, default=10, metavar="N",
                        help="In directory mode, how many largest files to list (default: 10).")
    parser.add_argument("--version", action="version", version=f"token {VERSION}")
    args = parser.parse_args()

    raw = " ".join(args.target)
    path = Path(raw).expanduser()

    if path.is_file():
        tokens = count_file(path)
        if args.as_json:
            print(json.dumps({"type": "file", "path": str(path), "tokens": tokens}))
        else:
            print(f"{human(tokens)} tokens  ~  {path.name}")
        return 0

    if path.is_dir():
        total, files = count_directory(path)
        if args.as_json:
            print(json.dumps({
                "type": "directory",
                "path": str(path),
                "tokens": total,
                "files": len(files),
                "largest": [{"file": f, "tokens": t} for f, t in files[: args.top]],
            }))
            return 0

        print(f"{human(total)} tokens  ~  {path.name}/  ({len(files)} files)")
        if files:
            print()
            width = max(len(f) for f, _ in files[: args.top])
            for name, tokens in files[: args.top]:
                print(f"  {name:<{width}}  {human(tokens):>7}")
            if len(files) > args.top:
                print(f"  ... and {len(files) - args.top} more")
        return 0

    # Not a path — treat as literal text.
    text = raw.strip("\"'")
    tokens = count_text(text)
    if args.as_json:
        print(json.dumps({"type": "text", "tokens": tokens, "chars": len(text)}))
    else:
        print(f"{human(tokens)} tokens  ~  {len(text)} chars")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
