#!/usr/bin/env bash
# install_entry_command — install the `entry` command into ~/bin.
# Usage: ./install_entry_command.sh
#
# Replaces the per-project `job` and `project` symlinks, which pointed ~/bin
# straight into freelance-payments and 360-design. One global command now reads
# each repo's own .agents/entry.json.
set -euo pipefail

VERSION="1.0.0"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/bin"
TARGET="$BIN_DIR/entry"

mkdir -p "$BIN_DIR"

cat > "$TARGET" <<SHIM
#!/usr/bin/env bash
# entry — installed by ${SOURCE_DIR}/install_entry_command.sh
# Do not edit here. Edit the source, then re-run the installer.
set -euo pipefail
SCRIPT="${SOURCE_DIR}/entry.py"
if [ ! -f "\$SCRIPT" ]; then
    echo "entry: source missing at \$SCRIPT" >&2
    echo "entry: clone git@github.com:seanivore/scripts.git and re-run install_entry_command.sh" >&2
    exit 1
fi
exec python3 "\$SCRIPT" "\$@"
SHIM

chmod +x "$TARGET"
echo "  installed  $TARGET"

echo
echo "Done. Run 'entry' from inside a repo that has .agents/entry.json"
echo "(start from ${SOURCE_DIR}/entry.example.json)"
