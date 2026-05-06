#!/usr/bin/env bash
# frdoc — Find and Replace Doc files
# Updates copies of a resource document across project directories
# from a single canonical source.
#
# See `frdoc -h` for usage.

set -euo pipefail

VERSION="1.0.0"

show_help() {
  cat <<'EOF'
frdoc - Find and replace resource document files with an updated version
        across project directories.

If you have an exact 'directory/filename.ext' present in many project
directories, you can update one canonical copy of it, run frdoc
(remember as: find replace document), and all matching paths inside
your search directory will be overwritten with the canonical version.

Usage:
  frdoc -n NEW -s SEARCH -r REPLACE [-y] [-d]
  frdoc                              (interactive walkthrough)
  frdoc -h                           (show this help)

Flags:
  -n NEW       Absolute path to the canonical (updated) source file.
               Must exist and be a regular file.

  -s SEARCH    Directory to search recursively (e.g., ~/Development).
               Must exist and be a directory.

  -r REPLACE   Path suffix to match (e.g., '.agent/DEV_RULES.md').
               Matches any file whose path ends with this string.

  -y           Skip confirmation prompt (non-interactive overwrite).

  -d           Dry run — print matches and what would happen, then exit.

  -h           Show this help and exit.

Behavior:
  - Walks SEARCH recursively for files whose path ends with REPLACE.
  - Skips the canonical NEW file itself if it would match.
  - Skips inside .git/, node_modules/, dist/, build/, .next/, .venv/.
  - Prints the list of matches and asks for confirmation (unless -y).
  - On confirm, copies NEW over each match (full overwrite; mode preserved).

Safety:
  Use git. frdoc does not back up the files it overwrites.
  All target projects should have clean working trees before running,
  so the change is a single reviewable diff.

Examples:
  # Sync your DEV_RULES.md from thot to every project under Development:
  frdoc -n ~/Development/thot/.agent/DEV_RULES.md \
        -s ~/Development \
        -r .agent/DEV_RULES.md

  # See what would change without writing anything:
  frdoc -d -n ~/Development/thot/.agent/DEV_RULES.md \
            -s ~/Development \
            -r .agent/DEV_RULES.md

EOF
}

# ---- Defaults ----
NEW=""
SEARCH=""
REPLACE=""
ASSUME_YES=0
DRY_RUN=0

# ---- Parse flags ----
while getopts ":n:s:r:ydh" opt; do
  case "$opt" in
    n) NEW="$OPTARG" ;;
    s) SEARCH="$OPTARG" ;;
    r) REPLACE="$OPTARG" ;;
    y) ASSUME_YES=1 ;;
    d) DRY_RUN=1 ;;
    h) show_help; exit 0 ;;
    \?) echo "frdoc: unknown flag -$OPTARG" >&2; echo "Try 'frdoc -h' for help." >&2; exit 2 ;;
    :)  echo "frdoc: flag -$OPTARG requires an argument" >&2; exit 2 ;;
  esac
done

# ---- Interactive walkthrough if no flags provided ----
if [[ -z "$NEW" && -z "$SEARCH" && -z "$REPLACE" ]]; then
  echo "frdoc — interactive mode (Ctrl-C to abort)"
  echo ""
  read -e -p "1) NEW (absolute path to updated source file): " NEW
  read -e -p "2) SEARCH (directory to search recursively): " SEARCH
  read -e -p "3) REPLACE (path suffix to match, e.g. .agent/DEV_RULES.md): " REPLACE
  echo ""
fi

# ---- Validate ----
if [[ -z "$NEW" || -z "$SEARCH" || -z "$REPLACE" ]]; then
  echo "frdoc: missing required input (-n, -s, -r). Run 'frdoc -h' for help." >&2
  exit 2
fi

# Expand ~ in inputs (in case user typed it literally)
NEW="${NEW/#\~/$HOME}"
SEARCH="${SEARCH/#\~/$HOME}"

# Resolve to absolute paths
if [[ "$NEW" != /* ]]; then
  NEW="$(cd "$(dirname "$NEW")" 2>/dev/null && pwd)/$(basename "$NEW")" || {
    echo "frdoc: could not resolve NEW path: $NEW" >&2; exit 2; }
fi

if [[ ! -f "$NEW" ]]; then
  echo "frdoc: NEW file does not exist or is not a regular file: $NEW" >&2
  exit 2
fi

if [[ ! -d "$SEARCH" ]]; then
  echo "frdoc: SEARCH directory does not exist: $SEARCH" >&2
  exit 2
fi

# Resolve SEARCH to absolute
SEARCH="$(cd "$SEARCH" && pwd)"

# Resolve NEW canonical (no symlink chase, just absolute)
NEW_ABS="$(cd "$(dirname "$NEW")" && pwd)/$(basename "$NEW")"

# ---- Find matches ----
# Match files whose path ends with /REPLACE (exact suffix, not partial filename match).
# Exclude common noise directories.
MATCHES=()
while IFS= read -r -d '' path; do
  # Skip the canonical source itself
  if [[ "$path" == "$NEW_ABS" ]]; then continue; fi
  # Suffix check: path must end with /REPLACE (so 'DEV_RULES.md' alone wouldn't match 'NOT_DEV_RULES.md')
  if [[ "$path" == */"$REPLACE" || "$path" == "$REPLACE" ]]; then
    MATCHES+=("$path")
  fi
done < <(find "$SEARCH" \
  \( -name .git -o -name node_modules -o -name dist -o -name build -o -name .next -o -name .venv \) -prune \
  -o -type f -name "$(basename "$REPLACE")" -print0)

if [[ ${#MATCHES[@]} -eq 0 ]]; then
  echo "frdoc: no matches for '$REPLACE' under $SEARCH"
  exit 0
fi

# ---- Show plan ----
echo "frdoc — sync plan"
echo "  source : $NEW_ABS"
echo "  search : $SEARCH"
echo "  match  : */$REPLACE"
echo ""
echo "Will overwrite ${#MATCHES[@]} file(s):"
for m in "${MATCHES[@]}"; do
  echo "  - $m"
done
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run — no files written."
  exit 0
fi

# ---- Confirm ----
if [[ $ASSUME_YES -ne 1 ]]; then
  read -p "Proceed? [y/N] " ans
  if [[ "$ans" != "y" && "$ans" != "Y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ---- Apply ----
fail=0
for m in "${MATCHES[@]}"; do
  if cp "$NEW_ABS" "$m"; then
    echo "  ✓ $m"
  else
    echo "  ✗ $m" >&2
    fail=1
  fi
done

if [[ $fail -ne 0 ]]; then
  echo "frdoc: completed with errors." >&2
  exit 1
fi

echo ""
echo "frdoc: ${#MATCHES[@]} file(s) updated."
