# Script Standard

**How every command in this repo is built.** Read this before adding a new one.

The point is that each command behaves like a native terminal command — same flags, same failure behaviour, same install path — rather than however a given session felt like building it. When commands are each shaped differently, you have to remember N conventions instead of one.

---

## Quick reference

The original five-step version, kept because it is still the fastest way to describe the shape:

| Step | Command |
| --- | --- |
| 1. Create command file in `~/bin` | `touch ~/bin/command-name.sh` |
| 2. Open that file in your editor | `nano ~/bin/command-name.sh` |
| 3. Paste the script into editor | It should have `#!/bin/bash` at the top |
| 4. Make script executable | `chmod +x ~/bin/command-name.sh` |
| 5. Run the script | `command-name.sh` |

**What changed since:** commands are no longer authored directly in `~/bin`. They live here in `~/Development/scripts`, under version control, and an installer places a shim in `~/bin`. Otherwise the machine is the only copy — which is exactly how the `gate` launcher — at the time the sole entry point to a 1,400-line engine — once ended up tracked nowhere at all. (`gate` itself was retired in July 2026; the lesson is why this repo exists.)

---

## Layout

One directory per tool:

```
scripts/
└── <tool_name>/
    ├── <tool_name>.sh                     # or .py — the actual implementation
    └── install_<tool_name>_command.sh     # installs a shim into ~/bin
```

Then add the tool to:
- the command table at the top of `README.md`, plus a short usage section
- the `INSTALLERS` array in `install_all.sh`

## The installer contract

The installer writes a **shim** into `~/bin` that execs the real script from this repo, with the repo path resolved at install time.

```bash
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

The shim must **check its source exists and fail with an actionable message.** This is the single most important rule here. The old `uid` command silently depended on a retired repo through a hardcoded path; when that repo moved, it failed with `No module named 'user_id_generator'` and nothing pointed at the cause. A shim that says *"source missing, clone the repo and re-run the installer"* costs three lines and saves an afternoon.

```bash
if [ ! -f "$SCRIPT" ]; then
    echo "<name>: source missing at $SCRIPT" >&2
    echo "<name>: clone git@github.com:seanivore/scripts.git and re-run install_<name>_command.sh" >&2
    exit 1
fi
exec python3 "$SCRIPT" "$@"
```

Never symlink `~/bin/<cmd>` into a project repo. That was how `job` and `project` were wired, and it makes a global command depend on a specific repo being present at a specific path.

## Required behaviour

Every command:

- `--help` (and `-h`) — usage, flags, and at least two examples
- `--version` — reads a `VERSION` constant near the top of the file
- Errors go to **stderr**, exit non-zero
- Exit `0` on success
- Nothing destructive without either a dry-run flag (`-n`) or an explicit confirmation
- Output composes: print the bare value, not `Generated UID: <value>`. Anything decorative forces callers to regex it back out, which is what the previous `uid` did to both of its consumers.

## Shell scripts

```bash
#!/usr/bin/env bash
# <tool> — one-line purpose
# Usage: <tool> [options] [target]
#
# A short paragraph on why this exists and any non-obvious behaviour. If the
# script fixes a specific past failure, name it — that is what stops someone
# reintroducing it.
set -uo pipefail

VERSION="1.0.0"
```

Use `#!/usr/bin/env bash`, not `#!/bin/bash`.

`set -euo pipefail` where it fits. Be aware that `-e` interacts badly with `find` and `grep` returning non-zero on no-match, so several scripts here deliberately use `set -uo pipefail` without `-e` and check exit codes explicitly.

**Traps to avoid, all of which have bitten a script in this repo:**

- **Counters inside `find | while read`** run in a subshell and never reach the parent. Use process substitution: `while read ...; do ...; done < <(find ...)`
- **`for f in $(find ...)`** breaks on paths with spaces. Use `-print0` with `read -r -d ''`
- **Empty array expansion under `set -u`** is an error on the bash 3.2 macOS still ships. Guard it: `${arr[@]+"${arr[@]}"}`
- **Measure before you mutate.** `clearpy` used to scan again after deleting, so it always reported "already clean" — it was describing the aftermath, not the work
- **Guard external dependencies.** `if ! command -v tree >/dev/null 2>&1; then` … with an install hint. Without it, a missing package reads as a bug in your script

## Python scripts

```python
#!/usr/bin/env python3
"""
<tool> — one-line purpose

Usage examples, then why this exists and any non-obvious behaviour.
"""
from __future__ import annotations

import argparse
import sys

VERSION = "1.0.0"
```

- `argparse` for flags — it gives `--help` for free and keeps the interface conventional
- `--version` via `parser.add_argument("--version", action="version", version=f"<tool> {VERSION}")`
- Return an int from `main()`; end with `raise SystemExit(main())`
- **Never name the file after a stdlib module.** `token.py` shadows Python's own `token` module on `sys.path[0]` and breaks every import of `inspect` — the token counter here is `count_tokens.py` for exactly this reason
- Shared logic goes in a sibling module the CLIs import (`uid/idgen.py` backs both `uid` and `mkid`), not copy-pasted between them

## Header block

Every script opens with: name, one-line purpose, usage, then a short paragraph of rationale.

Write the rationale for someone who has never seen the file. If the script exists because something specific went wrong, say what — the header is the only place that knowledge survives, and a rule without its reason gets deleted by the next person who finds it inconvenient.

## Versioning

`VERSION` constant near the top, printed by `--version`. Bump on change:

- **Patch** — bug fix, no interface change
- **Minor** — new flag or capability, backward compatible
- **Major** — flags removed or renamed, output format changed

Note the version in the commit message.

## Checklist

- [ ] Lives in `scripts/<tool_name>/`, not in `~/bin` and not in a project repo
- [ ] Has `install_<tool_name>_command.sh` that writes a shim with a missing-source guard
- [ ] Added to `install_all.sh`
- [ ] Added to the `README.md` command table, with a usage section
- [ ] `--help` and `--version` both work
- [ ] Errors go to stderr with a non-zero exit
- [ ] Dry-run or confirmation for anything destructive
- [ ] Output is bare and composable
- [ ] Tested against paths containing spaces
- [ ] Committed with a per-file note
