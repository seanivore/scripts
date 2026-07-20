#!/usr/bin/env bash
# install_uid_commands — install the `uid` and `mkid` commands into ~/bin.
# Usage: ./install_uid_commands.sh
#
# Installs two commands (they share the idgen.py core, so one installer covers
# both). Each is a small shim that execs the real script from this repo, with
# the repo path resolved at install time — the same approach ~/bin/gate uses.
#
# The shim checks its source exists and fails with an actionable message if it
# does not. The predecessor to this tool silently depended on a retired repo and
# broke without explanation when that repo moved; a clear error is the fix.
set -euo pipefail

VERSION="1.0.0"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/bin"

mkdir -p "$BIN_DIR"

install_shim() {
    local name="$1" script="$2" target="$BIN_DIR/$1"

    cat > "$target" <<SHIM
#!/usr/bin/env bash
# ${name} — installed by ${SOURCE_DIR}/install_uid_commands.sh
# Do not edit here. Edit the source, then re-run the installer.
set -euo pipefail
SCRIPT="${SOURCE_DIR}/${script}"
if [ ! -f "\$SCRIPT" ]; then
    echo "${name}: source missing at \$SCRIPT" >&2
    echo "${name}: the scripts repo has moved or is not cloned." >&2
    echo "${name}: clone git@github.com:seanivore/scripts.git and re-run install_uid_commands.sh" >&2
    exit 1
fi
exec python3 "\$SCRIPT" "\$@"
SHIM

    chmod +x "$target"
    echo "  installed  $target"
}

echo "Installing uid + mkid from $SOURCE_DIR"
install_shim "uid" "uid.py"
install_shim "mkid" "mkid.py"

if ! printf '%s' ":$PATH:" | grep -q ":$BIN_DIR:"; then
    echo
    echo "  note: $BIN_DIR is not on your PATH. Add to ~/.zshrc:"
    echo "        export PATH=\"\$PATH:\$HOME/bin\""
fi

echo
echo "Done. Try:  uid   |   mkid --prefix usr   |   uid --help"
