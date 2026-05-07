#!/usr/bin/env bash
# filemgmt — Bulk Directory File Management
# Replaces 'frdoc'

set -euo pipefail

VERSION="2.0.0"

show_help() {
  cat <<'EOF'
filemgmt - Bulk Directory File Management

Find and replace, or add, canonical resource documents across project directories.

Usage:
  filemgmt -f <TARGETS...> -r <REPLACE_FILE> [-y] [-d]
  filemgmt -f <TARGETS...> -a <ADD_FILE> [-y] [-d]
  filemgmt -h

Flags:
  -f, --find, -s, --search
               Target path(s) to search inside. This can be multiple paths,
               e.g., via bash globbing: ~/Development/*/.agent

  -r, --replace
               Absolute path to the canonical file to overwrite matches.
               If the target paths are directories matching the parent
               directory of this file, and the file is missing, it will
               implicitly add it.

  -a, --add
               Explicitly add a canonical file to the target paths.

  -y, --yes    Skip confirmation prompt.
  -d, --dry    Dry run — print matches/additions without writing.
  -h, --help   Show this help and exit.

Examples:
  # Add a new file to all .agent directories:
  filemgmt -f ~/Development/*/.agent -a ~/Development/thot/.agent/RESEARCH_PROTOCOL.md

  # Replace DEV_RULES.md everywhere it's found inside ~/Development:
  filemgmt -f ~/Development -r ~/Development/thot/.agent/DEV_RULES.md
EOF
}

TARGETS=()
CANONICAL=""
MODE=""
ASSUME_YES=0
DRY_RUN=0

# Helper to check for common ~ path typos
check_path_typo() {
  local p="$1"
  if [[ "$p" == \~* && ! -e "$p" && "$p" != \~/* ]]; then
    echo "Warning: Path '$p' does not exist." >&2
    echo "Did you mean '~/${p#\~*}' or '$HOME/${p#\~*}'?" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--find|-s|--search)
      shift
      # Collect all following arguments until the next flag
      while [[ $# -gt 0 && "$1" != -* ]]; do
        check_path_typo "$1"
        TARGETS+=("$1")
        shift
      done
      ;;
    -r|--replace)
      shift
      if [[ $# -gt 0 && "$1" != -* ]]; then
        check_path_typo "$1"
        CANONICAL="$1"
        MODE="REPLACE"
        shift
      else
        echo "Error: $1 requires an argument." >&2; exit 2
      fi
      ;;
    -a|--add)
      shift
      if [[ $# -gt 0 && "$1" != -* ]]; then
        check_path_typo "$1"
        CANONICAL="$1"
        MODE="ADD"
        shift
      else
        echo "Error: $1 requires an argument." >&2; exit 2
      fi
      ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -d|--dry) DRY_RUN=1; shift ;;
    -h|--help) show_help; exit 0 ;;
    -*) echo "Unknown flag $1" >&2; show_help; exit 2 ;;
    *) # If it's a loose argument, let's complain for now to enforce strict usage
       echo "Unexpected argument: $1" >&2; exit 2 ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 || -z "$CANONICAL" || -z "$MODE" ]]; then
  echo "Error: Missing required arguments. Provide targets (-f) and a canonical file (-r or -a)." >&2
  echo "Run 'filemgmt -h' for help." >&2
  exit 2
fi

CANONICAL="${CANONICAL/#\~/$HOME}"
if [[ "$CANONICAL" != /* ]]; then
  CANONICAL="$(cd "$(dirname "$CANONICAL")" 2>/dev/null && pwd)/$(basename "$CANONICAL")" || {
    echo "Error: could not resolve canonical path: $CANONICAL" >&2; exit 2; }
fi

if [[ ! -f "$CANONICAL" ]]; then
  echo "Error: Canonical file does not exist: $CANONICAL" >&2
  exit 2
fi

CANONICAL_BASENAME=$(basename "$CANONICAL")
CANONICAL_DIRNAME=$(basename "$(dirname "$CANONICAL")")

MATCHES=()
ADDS=()

# Process TARGETS
for target in "${TARGETS[@]}"; do
  target="${target/#\~/$HOME}"
  
  # For globs that didn't match anything, the shell might pass them literally (e.g., ~/Development/*/.agent)
  if [[ ! -e "$target" ]]; then
    if [[ "$target" == *\** ]]; then
       # Bash passed the glob string literally because nothing matched. Just ignore it cleanly without noise.
       continue
    fi
    echo "Warning: Target does not exist: $target" >&2
    continue
  fi

  target="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"

  if [[ "$MODE" == "ADD" ]]; then
    if [[ -d "$target" ]]; then
      dest_path="$target/$CANONICAL_BASENAME"
      if [[ "$dest_path" != "$CANONICAL" ]]; then
        ADDS+=("$dest_path")
      fi
    fi
  elif [[ "$MODE" == "REPLACE" ]]; then
    if [[ -d "$target" ]]; then
      # Check for implicit add:
      # If the target directory basename matches the canonical file's parent directory basename
      # AND the file doesn't exist there, it's an implicit add.
      target_basename=$(basename "$target")
      expected_dest="$target/$CANONICAL_BASENAME"
      
      if [[ "$target_basename" == "$CANONICAL_DIRNAME" && ! -e "$expected_dest" ]]; then
        if [[ "$expected_dest" != "$CANONICAL" ]]; then
          ADDS+=("$expected_dest")
        fi
      else
        # Standard REPLACE search
        while IFS= read -r -d '' p; do
          if [[ "$p" != "$CANONICAL" ]]; then
            MATCHES+=("$p")
          fi
        done < <(find "$target" \( -name .git -o -name node_modules -o -name dist -o -name build -o -name .next -o -name .venv \) -prune -o -type f -name "$CANONICAL_BASENAME" -print0)
      fi
    elif [[ -f "$target" ]]; then
      # If target is a file, verify it's the right name
      if [[ "$(basename "$target")" == "$CANONICAL_BASENAME" && "$target" != "$CANONICAL" ]]; then
        MATCHES+=("$target")
      fi
    fi
  fi
done

total_operations=$(( ${#MATCHES[@]} + ${#ADDS[@]} ))

if [[ $total_operations -eq 0 ]]; then
  echo "No matches or additions to process."
  exit 0
fi

echo "filemgmt — Execution Plan"
echo "  Canonical file : $CANONICAL"
echo ""

if [[ ${#MATCHES[@]} -gt 0 ]]; then
  echo "Will REPLACE ${#MATCHES[@]} file(s):"
  for m in "${MATCHES[@]}"; do
    echo "  ~> $m"
  done
  echo ""
fi

if [[ ${#ADDS[@]} -gt 0 ]]; then
  echo "Will ADD ${#ADDS[@]} new file(s):"
  for a in "${ADDS[@]}"; do
    echo "  +> $a"
  done
  echo ""
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run — no files written."
  exit 0
fi

if [[ $ASSUME_YES -ne 1 ]]; then
  read -p "Proceed? [y/N] " ans
  if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

fail=0

if [[ ${#MATCHES[@]} -gt 0 ]]; then
  for m in "${MATCHES[@]}"; do
    if cp "$CANONICAL" "$m"; then
      echo "  ✓ Replaced $m"
    else
      echo "  ✗ Failed $m" >&2
      fail=1
    fi
  done
fi

if [[ ${#ADDS[@]} -gt 0 ]]; then
  for a in "${ADDS[@]}"; do
    mkdir -p "$(dirname "$a")"
    if cp "$CANONICAL" "$a"; then
      echo "  ✓ Added $a"
    else
      echo "  ✗ Failed $a" >&2
      fail=1
    fi
  done
fi

if [[ $fail -ne 0 ]]; then
  echo "Completed with errors." >&2
  exit 1
fi

echo "All $total_operations operation(s) successful."
