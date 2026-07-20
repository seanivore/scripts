# scripts

Shared terminal commands. **This repo is the single source of truth** — every command lives here and installs to `~/bin`. Nothing here should ever be copied into a project repo.

## The commands

| Command | What it does | Example |
| --- | --- | --- |
| `uid` | Legacy unique ID, `uid-abc-123` | `uid --in assets/docs/` |
| `mkid` | Modern unique ID — **use this for new projects** | `mkid --prefix usr` |
| `token` | Estimate token count of text, a file, or a repo | `token .` |
| `clearpy` | Delete caches and temp files (`__pycache__`, `.DS_Store`, …) | `clearpy -n` |
| `ptree` | Project tree with hidden-file control | `ptree -s` |
| `filemgmt` | Propagate one canonical doc across every project | `filemgmt -f ~/Development -r <path>/.agents/DEV_RULES.md` |
| `gate` | Gap-review courier engine (Claude Agent SDK) | `gate <IMPLEMENT-path> --dry-run` |

Every command supports `--help` and `--version`.

## Install

```bash
git clone git@github.com:seanivore/scripts.git ~/Development/scripts
cd ~/Development/scripts
./install_all.sh
```

That installs all seven commands into `~/bin`. This is the fresh-machine path — one clone, one command.

`~/bin` must be on your PATH. In `~/.zshrc`:

```bash
export PATH="$PATH:$HOME/bin"
```

To reinstall a single command, run its own installer (`uid/install_uid_commands.sh`, `token/install_token_command.sh`, and so on).

**Prerequisites:** `python3` for `uid`/`mkid`/`token`, `tree` for `ptree` (`brew install tree`), Node + `npm install` inside `gate/` for `gate`.

---

## ID generation — which one to use

Two generators, one shared core (`uid/idgen.py`). Both draw from `secrets`, never the clock.

### `mkid` — the default for anything new

```bash
mkid                      # id_7k2mfq4x9btz3n
mkid --prefix usr         # usr_3nq8wt2fkx7mbz
mkid --prefix usr -n 3    # three at once
mkid --uuid7              # 01936f8a-7c41-7f3e-b8d1-4a9c2e5f0b73
mkid --in data/records/   # never reissue an ID already in that directory
```

Crockford base32 — no `i`, `l`, `o`, `u` — so IDs survive being read aloud, handwritten, or retyped. Default body length 14 gives about 4.4 × 10²¹ combinations. `--uuid7` emits time-ordered UUIDs that sort chronologically, which is what you want for database primary keys.

**For user IDs, `mkid --prefix usr` is the standard.** Generate once and store it alongside the user record. Do not derive a user ID from a username — a derived ID is reversible by brute force over a small name space, and any short derived format collides badly.

### `uid` — legacy format, existing repos only

```bash
uid                       # uid-abc-123
uid -n 5
uid --in assets/docs/     # checked against existing filenames
```

Exists because `360-design` and `freelance-payments` already have `uid-abc-123` baked into filenames, templates, and their prefix-swap conventions (`uid-` → `cou-` / `cus-`, and `uid-col-###` for collections). The namespace is only 26³ × 1000 ≈ 17.5M, so **pass `--in` whenever the ID becomes a filename** — that turns "probably unique" into "unique, full stop."

`col`, `cou`, and `cus` are never emitted as the middle segment, since those are claimed by the consumer repos.

### Why this was rewritten

The predecessor lived in the retired `modular-agent-orchestrator` repo, reached through a hardcoded `sys.path.append` in `~/bin/uid`. It worked only because that repo happened to still be on disk.

It also claimed "Guaranteed unique (timestamp-based)" and was not. Measured: **2000 rapid calls produced 3 unique IDs** — a 99.85% collision rate. Every part of the ID came from the clock, and the same-second collision counter was dead code, because each CLI invocation built a fresh generator that reset the counter to zero. The current version returns 2000 unique IDs from the same test.

---

## `token`

```bash
token README.md              # 1.7k tokens  ~  README.md
token .                      # whole directory, with the largest files listed
token "some text"
token . --json --top 20
```

Counts are **approximate** — a character-ratio estimate, roughly ±10%. There is no offline tokenizer for Claude, and the point of this command is an instant answer to "will this fit." Directory mode skips `.git`, `node_modules`, `venv`, and build output.

## `clearpy`

```bash
clearpy                  # clean the current directory
clearpy ~/my-project
clearpy -n               # dry run — preview, delete nothing
clearpy -v               # list every item as it goes
```

Removes `__pycache__`, `.pyc`/`.pyo`, `.DS_Store`, `.pytest_cache`, `.mypy_cache`, `.tox`, `.coverage`, `.cache`, and editor temp files. Scans once and reports from that scan — an earlier version re-scanned after deleting and so always reported "already clean" no matter how much it removed.

## `ptree`

```bash
ptree            # no hidden files
ptree -a         # all hidden files
ptree -s         # hidden files minus machine noise
ptree -a -L 2 ~/proj
```

`-s` is the useful one: keeps context directories like `.claude`, `.agents`, `.cursor`, and `.env`, while dropping `.DS_Store`, `.cache`, `__pycache__`, `.next`, and friends. Requires `tree` (`brew install tree`).

## `filemgmt`

Propagates one canonical file across every project directory.

```bash
filemgmt -f ~/Development -r ~/Development/_planner/.agents/DEV_RULES.md   # replace everywhere
filemgmt -f ~/Development -a <path>/NEW_SHARED_DOC.md                     # add a new shared file
filemgmt -f ~/Development -r <path>/BRAND.md -d                           # dry run
```

`-r` overwrites every same-named file it finds; it also adds the file where the target directory matches the canonical's parent (which is how new projects pick up `.agents/` docs). Prunes `.git`, `node_modules`, `dist`, `build`, `.next`, `.venv`. No backups — it relies on git for safety.

## `gate`

The gap-review courier engine — spawns peer Claude reviewers via the Agent SDK to run the DEV_RULES gap-review loop. Substantial enough to have its own docs: see [`gate/README.md`](gate/README.md) and [`gate/NEXT_UPDATE.md`](gate/NEXT_UPDATE.md) for status.

```bash
gate <IMPLEMENT-path> --dry-run    # resolve, parse, report — spawns nothing, no spend
```

Requires `npm install` inside `gate/`.

---

## Adding a new command

Read **[`SCRIPT_STANDARD.md`](SCRIPT_STANDARD.md)** first. It is the build standard every command here follows, and it exists so each one behaves like a native terminal command rather than however a given session felt like building it.

## Why everything lives here

`~/bin` is a single flat namespace, so a command is inherently global — there is no coherent way for `project` to mean one thing in one repo and something else in another. What *is* per-project is the **data** a command operates on, and that belongs in a config file inside the project repo.

`gate` already works this way: a global command here, reading `<repo>/.agents/GATE_NOTES.md` for per-project configuration. New commands should follow it.

The alternative was tried and failed. `uid` began life inside one project, got copied into others, and ended up with four byte-identical copies scattered across repos — none of which actually worked, while the real implementation sat in a retired repo that nothing tracked.
