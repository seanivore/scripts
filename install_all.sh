#!/usr/bin/env bash
# install_all — install every command in this repo into ~/bin.
# Usage: ./install_all.sh
#
# This is the fresh-machine answer. Clone the repo, run this once, and every
# terminal command is back. Before this existed, restoring a command meant
# remembering which of ~21 project repos happened to contain it — and one
# (`uid`) depended on a retired repo that was only still on disk by accident.
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/bin"

INSTALLERS=(
    "uid/install_uid_commands.sh"          # uid + mkid
    "entry/install_entry_command.sh"       # entry
    "token/install_token_command.sh"       # token
    "cache_cleaner/install_clearpy_command.sh"
    "project_tree/install_ptree_command.sh"
    "filemgmt/install_filemgmt.sh"
    "gate/install_gate_command.sh"
)

echo "Installing all commands from $SOURCE_DIR"
echo

failed=()
for installer in "${INSTALLERS[@]}"; do
    path="$SOURCE_DIR/$installer"
    if [ ! -f "$path" ]; then
        echo "  SKIP  $installer (not found)"
        failed+=("$installer")
        continue
    fi
    echo "→ $installer"
    if ! bash "$path" 2>&1 | sed 's/^/  /'; then
        failed+=("$installer")
    fi
done

echo
echo "─────────────────────────────────────────────"
if [ ${#failed[@]} -eq 0 ]; then
    echo "All commands installed."
else
    echo "Completed with ${#failed[@]} failure(s):"
    for item in "${failed[@]}"; do
        echo "  • $item"
    done
fi

echo
echo "Commands now available:"
for cmd in uid mkid entry token clearpy ptree filemgmt gate; do
    if [ -x "$BIN_DIR/$cmd" ]; then
        echo "  ✓ $cmd"
    else
        echo "  ✗ $cmd  (not installed)"
    fi
done

if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
    echo
    echo "note: $BIN_DIR is not on your PATH. Add to ~/.zshrc:"
    echo "      export PATH=\"\$PATH:\$HOME/bin\""
fi
