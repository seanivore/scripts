#!/usr/bin/env bash
# clearpy — development cache and temp file cleaner
# Usage: clearpy [directory] [-v] [-n] [-h]
#
# Scan once, report from that scan, then delete. The previous version scanned a
# second time *after* deleting, so a real run always found nothing left and
# printed "Directory was already clean!" no matter how much it had removed. Its
# counters were also incremented inside `find | while read` subshells, so they
# never survived back to the parent shell. Both are fixed by collecting targets
# up front and treating that list as the single source of truth.
set -uo pipefail

VERSION="2.0.0"

show_help() {
    cat <<'EOF'
clearpy - Development cache and temp file cleaner

Usage:
  clearpy [directory]     Clean specified directory (default: current)
  clearpy -v              Verbose — list every item as it is removed
  clearpy -n              Dry run — show what would be removed, delete nothing
  clearpy -h              Show this help
  clearpy --version       Show version

Removes:
  • __pycache__ directories and .pyc / .pyo files
  • .DS_Store files (macOS Finder metadata)
  • .pytest_cache / .mypy_cache / .tox directories
  • .coverage files
  • .cache directories (including node_modules/.cache)
  • Temporary editor files (.swp, .swo, .tmp, ~backup)

Examples:
  clearpy                 # Clean current directory
  clearpy ~/my-project    # Clean a specific directory
  clearpy -n              # Preview without deleting
EOF
}

TARGET_DIR="."
VERBOSE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help|help) show_help; exit 0 ;;
        --version)      echo "clearpy $VERSION"; exit 0 ;;
        -v|--verbose)   VERBOSE=true; shift ;;
        -n|--dry-run)   DRY_RUN=true; VERBOSE=true; shift ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Use 'clearpy -h' for help" >&2
            exit 1
            ;;
        *)              TARGET_DIR="$1"; shift ;;
    esac
done

if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist" >&2
    exit 1
fi
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

# Directories that are removed wholesale. Also pruned from the file scan so we
# never double-count a .pyc that lives inside a __pycache__ we already counted.
CACHE_DIR_EXPR=( -name '__pycache__' -o -name '.pytest_cache' -o -name '.mypy_cache' -o -name '.tox' -o -name '.cache' )
JUNK_FILE_EXPR=( -name '*.pyc' -o -name '*.pyo' -o -name '.DS_Store' -o -name '.coverage' -o -name '.coverage.*' -o -name '*.swp' -o -name '*.swo' -o -name '*.tmp' -o -name '*~' )

echo "🧹 Cleaning development cache files in: $TARGET_DIR"
[ "$DRY_RUN" = true ] && echo "👀 DRY RUN MODE - Nothing will actually be deleted"
echo ""
echo "🔍 Scanning..."

# ── Single scan. Everything reported below comes from these two lists. ───────
targets=()

while IFS= read -r -d '' item; do
    targets+=("$item")
done < <(find "$TARGET_DIR" -type d \( "${CACHE_DIR_EXPR[@]}" \) -prune -print0 2>/dev/null)

dir_count=${#targets[@]}

while IFS= read -r -d '' item; do
    targets+=("$item")
done < <(find "$TARGET_DIR" -type d \( "${CACHE_DIR_EXPR[@]}" \) -prune -o \
              -type f \( "${JUNK_FILE_EXPR[@]}" \) -print0 2>/dev/null)

total_items=${#targets[@]}
file_count=$((total_items - dir_count))

if [ "$total_items" -eq 0 ]; then
    echo ""
    echo "🎉 Directory is already clean!"
    exit 0
fi

# ── Size, measured before anything is removed ───────────────────────────────
total_kb=0
for item in "${targets[@]}"; do
    size_kb=$(du -sk "$item" 2>/dev/null | cut -f1)
    total_kb=$((total_kb + ${size_kb:-0}))
done

human_size() {
    local kb=$1
    if [ "$kb" -ge 1048576 ]; then
        echo "$((kb / 1048576)).$(((kb % 1048576) * 10 / 1048576))GB"
    elif [ "$kb" -ge 1024 ]; then
        echo "$((kb / 1024)).$(((kb % 1024) * 10 / 1024))MB"
    else
        echo "${kb}KB"
    fi
}
space_human=$(human_size "$total_kb")

# ── Remove ──────────────────────────────────────────────────────────────────
removed_count=0
for item in "${targets[@]}"; do
    [ -e "$item" ] || continue          # a parent dir may have taken it already
    if [ "$VERBOSE" = true ]; then
        if [ -d "$item" ]; then
            echo "  🗂️  ${item#"$TARGET_DIR"/}"
        else
            echo "  📄 ${item#"$TARGET_DIR"/}"
        fi
    fi
    if [ "$DRY_RUN" = false ]; then
        rm -rf "$item" 2>/dev/null
    fi
    removed_count=$((removed_count + 1))
done

# ── Summary, from the pre-delete scan ───────────────────────────────────────
echo ""
if [ "$DRY_RUN" = false ]; then
    echo "✅ Cleanup complete!"
    echo "🗑️  Cleaned $removed_count items and freed $space_human of disk space!"
else
    echo "📋 Would clean $removed_count items and free $space_human of disk space"
fi
[ "$dir_count" -gt 0 ]  && echo "   • $dir_count cache directories"
[ "$file_count" -gt 0 ] && echo "   • $file_count junk files"
echo "📁 Target: $TARGET_DIR"
[ "$DRY_RUN" = true ] && echo "" && echo "Run without -n to actually clean these files."
exit 0
