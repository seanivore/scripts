#!/bin/bash
# Install script for the clearpy cache cleaner command
# This script installs clearpy from ~/Development/scripts/cache_cleaner/

# Set paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/bin"
CLEARPY_SCRIPT="${SCRIPT_DIR}/clearpy.sh"

# Check if clearpy.sh exists
if [ ! -f "$CLEARPY_SCRIPT" ]; then
    echo "Error: clearpy.sh not found at $CLEARPY_SCRIPT"
    echo "Make sure you're running this from ~/Development/scripts/cache_cleaner/"
    exit 1
fi

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

# Backup existing clearpy if it exists
if [ -f "${BIN_DIR}/clearpy" ]; then
    echo "Backing up existing clearpy to clearpy.backup..."
    cp "${BIN_DIR}/clearpy" "${BIN_DIR}/clearpy.backup"
fi

# Copy the clearpy script to bin directory
echo "Installing clearpy command from ${SCRIPT_DIR}..."
cp "$CLEARPY_SCRIPT" "${BIN_DIR}/clearpy"

# Make the clearpy command executable
chmod +x "${BIN_DIR}/clearpy"

# Success message
echo "✅ clearpy installed successfully!"
echo "- 'clearpy' command installed in ${BIN_DIR}"
if [ -f "${BIN_DIR}/clearpy.backup" ]; then
    echo "- Previous version backed up as clearpy.backup"
fi
echo ""
echo "📋 Usage examples:"
echo "  clearpy                 # Clean current directory"
echo "  clearpy ~/my-project    # Clean specific directory"
echo "  clearpy -v              # Verbose mode (show what's being deleted)"
echo "  clearpy -n              # Dry run (preview what would be cleaned)"
echo "  clearpy -h              # Show help"
echo ""
echo "🧹 Perfect for cleaning Python cache files and development temp files!"

# Check if ~/bin is in PATH
if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
    echo ""
    echo "⚠️  Note: ~/bin is not in your PATH"
    echo "Add this to your shell profile (~/.zshrc, ~/.bashrc, etc.):"
    echo "export PATH=\"\$HOME/bin:\$PATH\""
    echo ""
    echo "Or run the command directly: ~/bin/clearpy"
fi

echo ""
echo "🗂️  Script location: ${SCRIPT_DIR}"
echo "📁 To update clearpy, modify clearpy.sh and run this installer again." 