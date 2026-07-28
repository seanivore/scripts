# scripts

Shared terminal commands. **This repo is the single source of truth** — every command lives here and installs to `~/bin`. Nothing here should ever be copied into a project repo.

## The commands

| Command | What it does | Example |
| --- | --- | --- |
| `uid` | Legacy unique ID, `uid-abc-123` | `uid --in assets/docs/` |
| `mkid` | Modern unique ID — **use this for new projects** | `mkid --prefix usr` |
| `entry` | New record from a project's template, with a fresh ID | `entry --type collection` |
| `token` | Estimate token count of text, a file, or a repo | `token .` |
| `clearpy` | Delete caches and temp files (`__pycache__`, `.DS_Store`, …) | `clearpy -n` |
| `ptree` | Project tree with hidden-file control | `ptree -s` |
| `filemgmt` | Propagate one canonical doc across every project | `filemgmt -f ~/Development -r <path>/BRAND.md` |

Every command supports `--help` and `--version`.

## Install

```bash
git clone git@github.com:seanivore/scripts.git ~/Development/scripts
cd ~/Development/scripts
./install_all.sh
```

That installs all eight commands into `~/bin`. This is the fresh-machine path — one clone, one command.

`~/bin` must be on your PATH. In `~/.zshrc`:

```bash
export PATH="$PATH:$HOME/bin"
```

To reinstall a single command, run its own installer (`uid/install_uid_commands.sh`, `token/install_token_command.sh`, and so on).

**Prerequisites:** `python3` for `uid`/`mkid`/`token`, `tree` for `ptree` (`brew install tree`).

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

Crockford base32 — no `i`, `l`, `o`, `u` — so IDs survive being read aloud, handwritten, or retyped. Default body length 14 gives about 4.4 × 10²¹ combinations. `--uuid7` emits time-ordered UUIDs that sort chronologically, which is what you want for database primary keys — but note it leaks creation order, so avoid it where the sequence should stay private.

**Families — one stem, several prefixes:**

```bash
mkid --prefix job --family cus,cou,pay
job_7k2mfq4x9btz3n
cus_7k2mfq4x9btz3n
cou_7k2mfq4x9btz3n
pay_7k2mfq4x9btz3n
```

Use this when one record produces several documents. The shared stem is the feature: someone holding the invoice, the coupon, and the receipt can see instantly that they belong together, where three unrelated IDs would make the set unnavigable. A stem is only issued when **every** member of the family is free, so `--in` checks the whole group rather than just the first. Pass `-n` for several families, separated by blank lines.

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

## `entry`

Creates a new record from a project's template, with a fresh unique ID. One global command; each repo describes its own behaviour in `<repo>/.agents/entry.json`.

```bash
entry                     # default type
entry --type collection
entry -n 3                # three at once
entry --dry-run           # show what would be created, write nothing
```

Run it from anywhere inside the repo — it finds the root by walking up to `.git`. IDs are always checked against the output directory, so a record can never overwrite an existing one.

Config (start from [`entry/entry.example.json`](entry/entry.example.json)):

```json
{
  "template_dir": "assets/docs",
  "output_dir":   "assets/docs",
  "id_format":    "legacy",
  "indent":       4,
  "default_type": "entry",
  "types": {
    "entry":      { "template": "_entry_template.json" },
    "collection": { "template": "_collection_template.json", "middle": "col" }
  },
  "stamp": { "id": "{id}" }
}
```

`stamp` maps dotted JSON paths to values; integers index lists (`price1.product.products.0`). `{id}` is the generated ID, and `{id:cus-}` swaps the leading prefix to derive a sibling ID.

This replaced `new_job.py` and `new_project.py`, which were ~90% identical and reached through `~/bin` symlinks pointing into their own repos.

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
filemgmt -f ~/Development -r ~/Development/_planner/assets/docs/BRAND.md  # replace everywhere
filemgmt -f ~/Development -a <path>/NEW_SHARED_DOC.md                     # add a new shared file
filemgmt -f ~/Development -r <path>/BRAND.md -d                           # dry run
```

`-r` overwrites every same-named file it finds; it also adds the file where the target directory matches the canonical's parent. **Note:** this is no longer used for the development protocol — that lives as one global copy at `~/.agents/` and is never distributed. Prunes `.git`, `node_modules`, `dist`, `build`, `.next`, `.venv`. No backups — it relies on git for safety.

---

## Adding a new command

Read **[`SCRIPT_STANDARD.md`](SCRIPT_STANDARD.md)** first. It is the build standard every command here follows, and it exists so each one behaves like a native terminal command rather than however a given session felt like building it.

## Why everything lives here

`~/bin` is a single flat namespace, so a command is inherently global — there is no coherent way for `project` to mean one thing in one repo and something else in another. What *is* per-project is the **data** a command operates on, and that belongs in a config file inside the project repo.

`entry` works this way: a global command here, reading `<repo>/.agents/entry.json` for per-project configuration. New commands should follow it.

The alternative was tried and failed. `uid` began life inside one project, got copied into others, and ended up with four byte-identical copies scattered across repos — none of which actually worked, while the real implementation sat in a retired repo that nothing tracked.
