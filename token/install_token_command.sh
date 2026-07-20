#!/usr/bin/env bash
# install_token_command — install the `token` command into ~/bin.
# Usage: ./install_token_command.sh
#
# Installs a shim that execs count_tokens.py from this repo, with the repo path
# resolved at install time. The shim reports a clear error if its source goes
# missing rather than failing cryptically.
set -euo pipefail

VERSION="2.0.0"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/bin"
TARGET="$BIN_DIR/token"

mkdir -p "$BIN_DIR"

if [ -f "$TARGET" ] && ! grep -q "installed by" "$TARGET" 2>/dev/null; then
    cp "$TARGET" "$TARGET.pre-scripts-repo.backup"
    echo "  backed up previous standalone version -> $TARGET.pre-scripts-repo.backup"
fi

cat > "$TARGET" <<SHIM
#!/usr/bin/env bash
# token — installed by ${SOURCE_DIR}/install_token_command.sh
# Do not edit here. Edit the source, then re-run the installer.
set -euo pipefail
SCRIPT="${SOURCE_DIR}/count_tokens.py"
if [ ! -f "\$SCRIPT" ]; then
    echo "token: source missing at \$SCRIPT" >&2
    echo "token: clone git@github.com:seanivore/scripts.git and re-run install_token_command.sh" >&2
    exit 1
fi
exec python3 "\$SCRIPT" "\$@"
SHIM

chmod +x "$TARGET"
echo "  installed  $TARGET"

if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
    echo
    echo "  note: $BIN_DIR is not on your PATH. Add to ~/.zshrc:"
    echo "        export PATH=\"\$PATH:\$HOME/bin\""
fi

echo
echo "Done. Try:  token README.md   |   token .   |   token --help"
