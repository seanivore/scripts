#!/usr/bin/env bash
# Installer for frdoc — copies frdoc.sh to ~/bin/frdoc and makes it executable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${SCRIPT_DIR}/frdoc.sh"
TARGET="${HOME}/bin/frdoc"

if [[ ! -f "$SOURCE" ]]; then
  echo "install_frdoc: source not found: $SOURCE" >&2
  exit 1
fi

mkdir -p "${HOME}/bin"
cp "$SOURCE" "$TARGET"
chmod +x "$TARGET"

echo "Installed: $TARGET"
echo ""

# PATH check
case ":$PATH:" in
  *":$HOME/bin:"*)
    echo "✓ ~/bin is on your PATH. Run 'frdoc -h' from anywhere."
    ;;
  *)
    echo "⚠ ~/bin is not on your PATH."
    echo "  Add this line to ~/.zshrc (or ~/.bashrc):"
    echo ""
    echo "      export PATH=\"\$HOME/bin:\$PATH\""
    echo ""
    echo "  Then reload: source ~/.zshrc"
    ;;
esac
