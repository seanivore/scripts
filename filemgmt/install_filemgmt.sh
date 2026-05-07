#!/usr/bin/env bash
# Installer for filemgmt — copies filemgmt.sh to ~/bin/filemgmt and makes it executable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${SCRIPT_DIR}/filemgmt.sh"
TARGET="${HOME}/bin/filemgmt"

if [[ ! -f "$SOURCE" ]]; then
  echo "install_filemgmt: source not found: $SOURCE" >&2
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
    echo "✓ ~/bin is on your PATH. Run 'filemgmt -h' from anywhere."
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
