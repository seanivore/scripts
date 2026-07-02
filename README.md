# Development Scripts Collection

This directory contains various development tools and utilities organized by category.

## Directory Structure

```
~/Development/scripts/
├── cache_cleaner/           # Python cache and temp file cleaner
│   ├── clearpy.sh          # Main clearpy script
│   └── install_clearpy_command.sh
├── project_tree/           # Enhanced project structure viewer
│   ├── ptree.sh           # Main ptree script
│   └── install_ptree_command.sh
├── filemgmt/               # Bulk Directory File Management
│   ├── filemgmt.sh        # Main filemgmt script
│   └── install_filemgmt.sh
├── gate/                   # Gap-review courier engine (TypeScript; Agent SDK peers)
│   ├── src/gate.ts        # The courier loop
│   ├── src/sdk.ts         # Agent SDK peer wrapper (strips key → Max subscription)
│   ├── src/probe.ts       # Verification gates (auth / compact / isolate / find)
│   ├── config.ts          # Angle + per-node model/effort
│   ├── templates/         # review-prompt.md + GATE_NOTES.example.md (the method as data)
│   └── README.md
└── README.md              # This file
```

## Installation

Each tool has its own installer script that copies the command to `~/bin/` for global access.

### Prerequisites

1. Ensure `~/bin` exists and is in your PATH:
   ```bash
   mkdir -p ~/bin
   echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc
   source ~/.zshrc
   ```

### Available Tools

#### clearpy - Cache Cleaner
Removes Python cache files, .DS_Store files, and other development temp files.

**Installation:**
```bash
cd ~/Development/scripts/cache_cleaner
./install_clearpy_command.sh
```

**Usage:**
```bash
clearpy                 # Clean current directory
clearpy ~/my-project    # Clean specific directory  
clearpy -v              # Verbose mode
clearpy -n              # Dry run (preview)
clearpy -h              # Help
```

**Removes:**
- `__pycache__` directories and `.pyc` files
- `.DS_Store` files (macOS Finder metadata)
- `.pytest_cache`, `.mypy_cache`, `.tox` directories
- `.coverage` files and `.cache` directories
- Temporary editor files (`.swp`, `.tmp`, `~backup` files)

#### ptree - Enhanced Project Tree
Enhanced project structure viewer with hidden file control.

**Installation:**
```bash
cd ~/Development/scripts/project_tree
./install_ptree_command.sh
```

**Usage:**
```bash
ptree           # Normal tree (no hidden files)
ptree -a        # Show ALL hidden files
ptree -s        # Show SELECT hidden files (.claude, .cursor, etc.)
ptree -h        # Help
```

**Features:**
- Smart hidden file filtering
- Shows important config files (`.gitignore`, `.env`, etc.)
- Highlights development directories (`.claude`, `.cursor`, etc.)
- Excludes noise (`node_modules`, `.git`, cache dirs)

#### filemgmt - Bulk Directory File Management
Find and replace, or add, canonical resource documents across project directories. Extremely useful for keeping `.agent/DEV_RULES.md`, `BRAND.md`, or any other shared resource doc in sync from a single source.

**Installation:**
```bash
cd ~/Development/scripts/frdoc
./install_filemgmt.sh
```

**Usage:**
```bash
# Add a new file to all .agent directories:
filemgmt -f ~/Development/*/.agent -a ~/Development/thot/.agent/RESEARCH_PROTOCOL.md

# Replace DEV_RULES.md everywhere it's found inside ~/Development:
filemgmt -f ~/Development -r ~/Development/thot/.agent/DEV_RULES.md

filemgmt -d ...                # Dry run (preview matches, no writes)
filemgmt -y ...                # Skip confirmation prompt
filemgmt -h                    # Help
```

**Behavior:**
- Collects multiple directories if bash globbing is used (e.g. `*` or `**`).
- With `-r` (replace): Searches target directories and overwrites existing files. If the target directory name matches the canonical file's parent folder (e.g., `.agent`), it will implicitly add the file if it's missing!
- With `-a` (add): Adds the canonical file into every target directory specified.
- Checks paths for typos (like `~User/...`) and provides help.
- Relies on git for safety — no internal backups.

#### gate - Gap-Review Courier Engine
Automates the DEV_RULES *Gap-Review Gate* loop: spawns genuinely-separate **peer** Claude reviewers (Agent SDK `query()` processes — A cold/no-repo, B/C/D repo — never subagents) on the **Max subscription**, couriers prompts + findings to/from the resumed Build-Guide orchestrator thread, and loops until every angle verdicts READY — pausing only when a finding needs a human decision. The method lives as editable data (`templates/` + `config.ts`); the script is plumbing. See `gate/README.md`.

**Install:** the launcher is `~/bin/gate` (a bash shim that runs the TS engine via the local `tsx`). Requires `node` 22+; the Agent SDK + `tsx` are installed in `gate/`. Auth is the `claude.ai` Max login (no API key).

**Usage:**
```bash
gate ~/Development/<repo>/assets/docs/archive/vX_Y/vX_Y_Z_IMPLEMENT.md --phase A
gate <IMPLEMENT-path> --dry-run                         # resolve + parse + report, no spend
gate <IMPLEMENT-path> --phase BCD --max-rounds 8
```

**Status:** first cut, foundation **proven** — subscription auth (`claude.ai / max`), `/compact` drivable via the SDK, Angle-A filesystem wall, and orchestrator resume-by-title all verified; `--dry-run` validated on real docs. Supervised live pilot next.

## Adding New Tools

When creating new development tools:

1. Create a new subdirectory: `~/Development/scripts/tool_name/`
2. Include the main script and an installer: `tool_name.sh` and `install_tool_name_command.sh`
3. Follow the pattern:
   ```bash
   # In installer script:
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   cp "${SCRIPT_DIR}/tool_name.sh" "${HOME}/bin/tool_name"
   ```
4. Update this README with documentation
5. Make sure the installer copies to `~/bin/` for global access

## Benefits of Centralized Scripts

- **Reusable**: Available across all projects
- **Organized**: Categorized by function
- **Maintainable**: Easy to update and version
- **Portable**: Can be synced across machines
- **Discoverable**: All tools documented in one place

## Integration with Projects

Individual projects (like MAO) can reference these scripts but the canonical versions live here. Projects should include a `DEVELOPMENT_TOOLS.md` pointing to this centralized location rather than duplicating the tools. 