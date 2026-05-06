#!/bin/bash
# Install script for the enhanced project tree command
# This script installs ptree from ~/Development/scripts/project_tree/

# Set paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/bin"
PTREE_SCRIPT="${SCRIPT_DIR}/ptree.sh"

# Check if ptree.sh exists
if [ ! -f "$PTREE_SCRIPT" ]; then
    echo "Error: ptree.sh not found at $PTREE_SCRIPT"
    echo "Make sure you're running this from ~/Development/scripts/project_tree/"
    exit 1
fi

# Create bin directory if it doesn't exist
mkdir -p "$BIN_DIR"

# Backup existing ptree if it exists
if [ -f "${BIN_DIR}/ptree" ]; then
    echo "Backing up existing ptree to ptree.backup..."
    cp "${BIN_DIR}/ptree" "${BIN_DIR}/ptree.backup"
fi

# Copy the ptree script to bin directory
echo "Installing ptree command from ${SCRIPT_DIR}..."
cp "$PTREE_SCRIPT" "${BIN_DIR}/ptree"

# Make the ptree command executable
chmod +x "${BIN_DIR}/ptree"

# Success message
echo "✅ ptree installed successfully!"
echo "- 'ptree' command installed in ${BIN_DIR}"
if [ -f "${BIN_DIR}/ptree.backup" ]; then
    echo "- Previous version backed up as ptree.backup"
fi
echo ""
echo "📋 Usage examples:"
echo "  ptree           # Show normal tree (no hidden files)"
echo "  ptree -a        # Show ALL hidden files"
echo "  ptree -s        # Show SELECT hidden files (.claude, .cursor, etc.)"
echo "  ptree -h        # Show help"
echo ""
echo "🌳 Perfect for viewing project structure with hidden file control!"

# Check if ~/bin is in PATH
if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
    echo ""
    echo "⚠️  Note: ~/bin is not in your PATH"
    echo "Add this to your shell profile (~/.zshrc, ~/.bashrc, etc.):"
    echo "export PATH=\"\$HOME/bin:\$PATH\""
    echo ""
    echo "Or run the command directly: ~/bin/ptree"
fi

echo ""
echo "🗂️  Script location: ${SCRIPT_DIR}"
echo "📁 To update ptree, modify ptree.sh and run this installer again." 