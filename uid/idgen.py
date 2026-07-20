#!/usr/bin/env python3
"""
idgen — shared ID-generation core for the `uid` and `mkid` commands.

WHY THIS EXISTS
    The previous generator (modular-agent-orchestrator/scripts/unique_id_generator)
    derived every part of the ID from the system clock and claimed to be
    "Guaranteed unique (timestamp-based)". It was not. Measured behaviour:

        2000 rapid calls  ->    3 unique IDs   (99.85% collision)
        3000 calls spread across a simulated year -> 0.2% collision

    Two root causes, both fixed here:
      1. Zero random entropy. Letters and digits were both functions of the
         clock, so the same instant always produced the same ID.
      2. The same-second collision counter was dead code. Each CLI invocation
         built a fresh generator object, resetting the counter to 0, so the
         guard at its core never fired even once in real use.

    This module uses `secrets` (cryptographic entropy, never the clock) and
    offers an explicit directory check for callers that need a hard guarantee
    rather than a probabilistic one.

TWO FORMATS
    legacy  uid-abc-123           Existing repos (360-design, freelance-payments).
                                  Namespace 26^3 x 1000 ~= 17.5M. Short and
                                  readable, but small enough that the directory
                                  check below is what makes it truly safe.

    modern  usr_7k2mfq4x9btz3n    New projects. Crockford base32 (no i/l/o/u,
                                  so it survives being read aloud or retyped).
                                  Default length 14 -> ~4.4e21 combinations.

COLLISION STRATEGY
    Random alone is "probably unique". Random + a scan of the directory the ID
    will live in is "unique, full stop". Since these IDs become filenames, the
    filesystem is already the authoritative index — there is no reason to guess
    when we can look. Callers that skip the check still get cryptographic
    entropy, which is strictly better than what came before.
"""

from __future__ import annotations

import os
import secrets
import string
from pathlib import Path
from typing import Iterable, Optional, Set

VERSION = "1.0.0"

# ── Legacy format (uid-abc-123) ──────────────────────────────────────────────

LEGACY_LETTERS = string.ascii_lowercase
LEGACY_PREFIX = "uid"

# Three-letter middle segments that consumer repos claim for their own meaning:
#   col -> collections   (360-design/assets/scripts/new_project.py)
#   cou -> coupons       (freelance-payments/assets/scripts/new_job.py)
#   cus -> customers     (freelance-payments/assets/scripts/new_job.py)
# Those repos build sibling IDs by string-swapping the segment, so a randomly
# drawn "col" would be indistinguishable from a real collection ID. Never emit
# them.
RESERVED_SEGMENTS: Set[str] = {"col", "cou", "cus"}

# ── Modern format (usr_7k2mfq4x9btz3n) ───────────────────────────────────────

# Crockford base32, lowercased. Excludes i, l, o, u — the first three because
# they are visually ambiguous with 1/1/0, and u to avoid accidental profanity.
CROCKFORD32 = "0123456789abcdefghjkmnpqrstvwxyz"

DEFAULT_MODERN_LENGTH = 14
DEFAULT_MODERN_PREFIX = "id"

MAX_ATTEMPTS = 10_000


class IdGenerationError(RuntimeError):
    """Raised when a unique ID could not be produced."""


# ── Directory awareness ──────────────────────────────────────────────────────


def existing_ids(directory: os.PathLike | str) -> Set[str]:
    """
    Collect IDs already present in `directory`.

    An ID is considered taken if any file there is named `<id>` or `<id>.<ext>`
    (e.g. `uid-abc-123.json`). Read once up front so generating N ids is one
    directory scan, not N.
    """
    path = Path(directory).expanduser()
    if not path.is_dir():
        raise IdGenerationError(f"Not a directory: {path}")

    taken: Set[str] = set()
    for child in path.iterdir():
        taken.add(child.name)          # exact match, extensionless
        taken.add(child.stem)          # strips one extension
    return taken


# ── Generation ───────────────────────────────────────────────────────────────


def _legacy_candidate() -> str:
    """One random `uid-abc-123`, honouring the reserved-segment rule."""
    while True:
        middle = "".join(secrets.choice(LEGACY_LETTERS) for _ in range(3))
        if middle not in RESERVED_SEGMENTS:
            break
    number = secrets.randbelow(1000)
    return f"{LEGACY_PREFIX}-{middle}-{number:03d}"


def _modern_candidate(prefix: str, length: int) -> str:
    body = "".join(secrets.choice(CROCKFORD32) for _ in range(length))
    return f"{prefix}_{body}" if prefix else body


def _generate(make_candidate, count: int, taken: Optional[Set[str]]) -> list[str]:
    """
    Draw `count` distinct IDs, avoiding anything in `taken`.

    Newly issued IDs are added to the working set as we go, so a batch is
    internally unique as well as unique against the directory.
    """
    seen: Set[str] = set(taken) if taken else set()
    issued: list[str] = []

    for _ in range(count):
        for attempt in range(MAX_ATTEMPTS):
            candidate = make_candidate()
            if candidate not in seen:
                seen.add(candidate)
                issued.append(candidate)
                break
        else:
            raise IdGenerationError(
                f"Could not find a free ID after {MAX_ATTEMPTS} attempts — the "
                f"namespace is likely exhausted for this format. If you are using "
                f"the legacy `uid` format (17.5M combinations), consider `mkid`."
            )
    return issued


def legacy_ids(count: int = 1, check_dir: Optional[str] = None) -> list[str]:
    """Generate `count` legacy `uid-abc-123` IDs."""
    taken = existing_ids(check_dir) if check_dir else None
    return _generate(_legacy_candidate, count, taken)


def modern_ids(
    count: int = 1,
    prefix: str = DEFAULT_MODERN_PREFIX,
    length: int = DEFAULT_MODERN_LENGTH,
    check_dir: Optional[str] = None,
) -> list[str]:
    """Generate `count` modern `prefix_xxxxxxxxxxxxxx` IDs."""
    if length < 1:
        raise IdGenerationError("Length must be at least 1.")
    taken = existing_ids(check_dir) if check_dir else None
    return _generate(lambda: _modern_candidate(prefix, length), count, taken)


def uuid7_ids(count: int = 1) -> list[str]:
    """
    Generate `count` UUIDv7s — time-ordered, so they sort chronologically and
    index well as database primary keys.

    Uses the stdlib implementation on Python 3.14+, and falls back to a
    spec-compliant local build otherwise so a machine on an older Python still
    works.
    """
    try:
        from uuid import uuid7  # Python 3.14+

        return [str(uuid7()) for _ in range(count)]
    except ImportError:
        return [_uuid7_fallback() for _ in range(count)]


def _uuid7_fallback() -> str:
    """RFC 9562 UUIDv7: 48-bit ms timestamp, 4-bit version, 74 bits random."""
    import time
    import uuid

    timestamp_ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF
    value = timestamp_ms << 80
    value |= 0x7 << 76                          # version 7
    value |= secrets.randbits(12) << 64         # rand_a
    value |= 0b10 << 62                         # RFC 9562 variant
    value |= secrets.randbits(62)               # rand_b
    return str(uuid.UUID(int=value))


# ── Shared CLI helpers ───────────────────────────────────────────────────────


def emit(ids: Iterable[str]) -> None:
    """
    Print IDs one per line, bare.

    Deliberately unadorned: the old command printed `Generated UID: uid-abc-123`,
    which forced every consumer to regex the value back out. A bare ID composes
    directly in shell pipelines and `$(...)` capture.
    """
    for value in ids:
        print(value)
