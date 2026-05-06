#!/bin/bash
# Enhanced project tree with hidden file control
# Usage: ptree [options]

show_help() {
    echo "ptree - Enhanced project tree viewer"
    echo ""
    echo "Usage:"
    echo "  ptree           Show normal tree (default behavior)"
    echo "  ptree -a        Show ALL hidden files and directories"
    echo "  ptree -s        Show SELECT hidden files (.claude, .cursor, .notes, etc.)"
    echo "  ptree -h        Show this help"
    echo ""
    echo "Examples:"
    echo "  ptree           # Normal tree, no hidden files"
    echo "  ptree -a        # Include all hidden files"
    echo "  ptree -s        # Show only important hidden files"
}

show_normal_tree() {
    echo "Project Structure (excluding hidden files):"
    echo "=========================================="
    tree -C -I "node_modules|target|venv|.git|.*" --prune
}

show_selective_hidden() {
    echo "Project Structure (with select hidden files):"
    echo "============================================="
    
    # Show normal tree but include specific hidden directories
    tree -C -I "node_modules|target|venv|.git" --prune -a | grep -v -E '^\.\.$|^\.$' | \
    grep -E -v '^\.[^/]*$' || tree -C -I "node_modules|target|venv|.git|.DS_Store|.cache|.npm|.yarn" --prune
    
    echo ""
    echo "Important Hidden Items:"
    echo "======================"
    
    # Show specific hidden directories with their contents
    for dir in .claude .cursor .notes .drafts .planning .idea .vscode .ai.dev-resources; do
        if [ -d "$dir" ]; then
            echo ""
            echo "📁 $dir/"
            tree -C -L 2 "$dir" 2>/dev/null || ls -la "$dir" | tail -n +2 | head -10
        fi
    done
    
    # Show specific hidden files
    echo ""
    echo "Hidden Files:"
    echo "============"
    for file in .gitignore .env .env.example .aider.conf.yml .cursorrules .claude_context; do
        if [ -f "$file" ]; then
            echo "📄 $file"
        fi
    done
}

show_all_hidden() {
    echo "Project Structure (including ALL hidden files):"
    echo "==============================================="
    tree -C -I "node_modules|target|venv" --prune -a
}

# Parse command line arguments
case "${1:-}" in
    -h|--help|help)
        show_help
        ;;
    -a|--all)
        show_all_hidden
        ;;
    -s|--select)
        show_selective_hidden
        ;;
    "")
        show_normal_tree
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use 'ptree -h' for help"
        exit 1
        ;;
esac 