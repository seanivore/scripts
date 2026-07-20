#!/usr/bin/env bash
# install_gate_command — install the `gate` command into ~/bin.
# Usage: ./install_gate_command.sh
#
# Until now the gate launcher existed ONLY as a hand-written ~/bin/gate, tracked
# nowhere. The engine is ~1,400 lines of TypeScript in this repo, but its single
# entry point would have died with the machine. This installer generates that
# shim from source so the launcher is reproducible.
#
# package.json declares `bin: { gate: "src/gate.ts" }`, but that path is never
# used — the shim is what actually runs, because it prefers the repo-local tsx
# before falling back to a global or npx one.
set -euo pipefail

VERSION="1.0.0"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/bin"
TARGET="$BIN_DIR/gate"

mkdir -p "$BIN_DIR"

cat > "$TARGET" <<SHIM
#!/usr/bin/env bash
# gate — the gap-review courier engine (Claude Agent SDK, on the Max subscription).
# Installed by ${SOURCE_DIR}/install_gate_command.sh — do not edit here.
#
# Usage:  gate <IMPLEMENT-path> [--phase A|BCD|all] [--max-rounds N] [--dry-run]
#         [--orchestrator-title "..."] [--orchestrator-id <uuid>] [--project-doc <path>]
#
# Pass an absolute or ~ IMPLEMENT path to run from anywhere — the repo root is
# derived from the file (nearest .git). Reviewers are separate SDK peers (never
# subagents); the engine strips ANTHROPIC_API_KEY so auth is your claude.ai Max
# login. --dry-run resolves + parses + reports and spawns nothing (no spend).
# See ${SOURCE_DIR}/README.md.
set -euo pipefail
GATE_DIR="${SOURCE_DIR}"
ENGINE="\$GATE_DIR/src/gate.ts"
if [ ! -f "\$ENGINE" ]; then
    echo "gate: engine missing at \$ENGINE" >&2
    echo "gate: clone git@github.com:seanivore/scripts.git and re-run install_gate_command.sh" >&2
    exit 1
fi
if [ -x "\$GATE_DIR/node_modules/.bin/tsx" ]; then
  exec "\$GATE_DIR/node_modules/.bin/tsx" "\$ENGINE" "\$@"
elif command -v tsx >/dev/null 2>&1; then
  exec tsx "\$ENGINE" "\$@"
else
  exec npx tsx "\$ENGINE" "\$@"
fi
SHIM

chmod +x "$TARGET"
echo "  installed  $TARGET"

if [ ! -d "$SOURCE_DIR/node_modules" ]; then
    echo
    echo "  note: dependencies are not installed. Run:"
    echo "        cd $SOURCE_DIR && npm install"
fi

echo
echo "Done. Try:  gate --help"
