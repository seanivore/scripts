#!/usr/bin/env bash
# ptree — project tree viewer with hidden-file control
# Usage: ptree [-a|-s] [-L depth] [directory]
#
# Wrapper around `tree` with three visibility modes. The previous -s mode piped
# tree through two greps with a `||` fallback that fired unpredictably, so the
# output differed run to run and was effectively unmaintainable. Each mode is
# now a single tree invocation with an explicit ignore pattern — what you see is
# what the pattern says.
set -uo pipefail

VERSION="2.0.0"

# Always excluded — heavy build/dependency output, never interesting in a tree.
ALWAYS_IGNORE="node_modules|target|venv|.venv|.git"

# Additionally excluded in -s (select) mode: hidden dirs that are machine noise
# rather than project context.
NOISE_IGNORE=".DS_Store|.cache|.npm|.yarn|.pytest_cache|__pycache__|.mypy_cache|.next|.turbo|.ruff_cache"

show_help() {
    cat <<'EOF'
ptree - Project tree viewer with hidden-file control

Usage:
  ptree                   Normal tree — no hidden files
  ptree -a                ALL hidden files and directories
  ptree -s                SELECT hidden — hidden files minus machine noise
                          (keeps .claude, .agents, .cursor, .env; drops
                          .DS_Store, .cache, __pycache__, .next, ...)
  ptree -L <n>            Limit depth to n levels
  ptree [directory]       Target a directory (default: current)
  ptree -h                Show this help
  ptree --version         Show version

Examples:
  ptree                   # Normal tree of the current directory
  ptree -s                # Include the hidden dirs that carry project context
  ptree -a -L 2 ~/proj    # All hidden, two levels deep, specific directory
EOF
}

MODE="normal"
DEPTH=""
TARGET="."

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help|help) show_help; exit 0 ;;
        --version)      echo "ptree $VERSION"; exit 0 ;;
        -a|--all)       MODE="all"; shift ;;
        -s|--select)    MODE="select"; shift ;;
        -L|--level)
            DEPTH="${2:-}"
            if ! [[ "$DEPTH" =~ ^[0-9]+$ ]]; then
                echo "ptree: -L requires a number" >&2
                exit 1
            fi
            shift 2
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Use 'ptree -h' for help" >&2
            exit 1
            ;;
        *)              TARGET="$1"; shift ;;
    esac
done

# Dependency guard. Without this the script failed with a raw "command not
# found" from inside a function, which reads as a bug in ptree rather than a
# missing package.
if ! command -v tree >/dev/null 2>&1; then
    echo "ptree: requires the 'tree' command, which is not installed." >&2
    echo "ptree: install it with:  brew install tree" >&2
    exit 1
fi

if [ ! -d "$TARGET" ]; then
    echo "ptree: '$TARGET' is not a directory" >&2
    exit 1
fi

# macOS still ships bash 3.2, where expanding an empty array under `set -u` is
# an "unbound variable" error. The ${arr[@]+...} guard makes an empty depth
# argument list expand to nothing instead of exploding.
depth_args=()
[ -n "$DEPTH" ] && depth_args=(-L "$DEPTH")

case "$MODE" in
    normal)
        echo "Project Structure (excluding hidden files):"
        echo "=========================================="
        tree -C --prune -I "$ALWAYS_IGNORE|.*" ${depth_args[@]+"${depth_args[@]}"} "$TARGET"
        ;;
    all)
        echo "Project Structure (including ALL hidden files):"
        echo "==============================================="
        tree -C --prune -a -I "$ALWAYS_IGNORE" ${depth_args[@]+"${depth_args[@]}"} "$TARGET"
        ;;
    select)
        echo "Project Structure (with select hidden files):"
        echo "============================================="
        tree -C --prune -a -I "$ALWAYS_IGNORE|$NOISE_IGNORE" ${depth_args[@]+"${depth_args[@]}"} "$TARGET"
        ;;
esac
