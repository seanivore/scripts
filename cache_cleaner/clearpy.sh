#!/bin/bash
# Cache cleaner for Python projects and general development cleanup
# Usage: clearpy [directory] [options]

show_help() {
    echo "clearpy - Development cache and temp file cleaner"
    echo ""
    echo "Usage:"
    echo "  clearpy [directory]     Clean specified directory (default: current)"
    echo "  clearpy -h             Show this help"
    echo "  clearpy -v             Verbose mode (show what's being deleted)"
    echo "  clearpy -n             Dry run (show what would be deleted)"
    echo ""
    echo "Removes:"
    echo "  • __pycache__ directories and .pyc files"
    echo "  • .DS_Store files (macOS Finder metadata)"
    echo "  • .pytest_cache directories"
    echo "  • .mypy_cache directories" 
    echo "  • .tox directories"
    echo "  • .coverage files"
    echo "  • .cache directories"
    echo "  • node_modules/.cache directories"
    echo "  • Temporary editor files (.swp, .tmp, ~backup files)"
    echo ""
    echo "Examples:"
    echo "  clearpy                 # Clean current directory"
    echo "  clearpy ~/my-project    # Clean specific directory"
    echo "  clearpy -v              # Show what's being cleaned"
    echo "  clearpy -n              # Preview what would be cleaned"
}

# Default values
TARGET_DIR="."
VERBOSE=false
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help|help)
            show_help
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -n|--dry-run)
            DRY_RUN=true
            VERBOSE=true  # Dry run implies verbose
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            echo "Use 'clearpy -h' for help"
            exit 1
            ;;
        *)
            TARGET_DIR="$1"
            shift
            ;;
    esac
done

# Validate target directory
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist"
    exit 1
fi

# Convert to absolute path
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

echo "🧹 Cleaning development cache files in: $TARGET_DIR"
if [ "$DRY_RUN" = true ]; then
    echo "👀 DRY RUN MODE - Nothing will actually be deleted"
fi
echo ""

# Initialize counters
removed_count=0
freed_space_kb=0

# Function to safely remove with logging
safe_remove() {
    local target="$1"
    local type="$2"
    
    if [ -e "$target" ]; then
        # Calculate size in KB before removal
        local size_kb=0
        if [ -d "$target" ]; then
            size_kb=$(du -sk "$target" 2>/dev/null | cut -f1)
            size_human=$(du -sh "$target" 2>/dev/null | cut -f1)
        else
            size_kb=$(du -sk "$target" 2>/dev/null | cut -f1)
            size_human=$(du -sh "$target" 2>/dev/null | cut -f1)
        fi
        
        # Add to total freed space
        freed_space_kb=$((freed_space_kb + size_kb))
        
        # Show what's being removed (if verbose or dry run)
        if [ "$VERBOSE" = true ]; then
            if [ -d "$target" ]; then
                echo "  🗂️  $type: $target ($size_human)"
            else
                echo "  📄 $type: $target ($size_human)"
            fi
        fi
        
        # Remove if not dry run
        if [ "$DRY_RUN" = false ]; then
            rm -rf "$target" 2>/dev/null
        fi
        
        removed_count=$((removed_count + 1))
    fi
}

# Clean __pycache__ directories
echo "🐍 Cleaning Python cache files..."
find "$TARGET_DIR" -type d -name "__pycache__" 2>/dev/null | while read -r cache_dir; do
    safe_remove "$cache_dir" "__pycache__ directory"
done

# Clean .pyc files
find "$TARGET_DIR" -type f -name "*.pyc" 2>/dev/null | while read -r pyc_file; do
    safe_remove "$pyc_file" ".pyc file"
done

# Clean .pyo files
find "$TARGET_DIR" -type f -name "*.pyo" 2>/dev/null | while read -r pyo_file; do
    safe_remove "$pyo_file" ".pyo file"
done

# Clean .DS_Store files
echo "🍎 Cleaning macOS metadata..."
find "$TARGET_DIR" -type f -name ".DS_Store" 2>/dev/null | while read -r ds_file; do
    safe_remove "$ds_file" ".DS_Store file"
done

# Clean pytest cache
echo "🧪 Cleaning test cache files..."
find "$TARGET_DIR" -type d -name ".pytest_cache" 2>/dev/null | while read -r pytest_dir; do
    safe_remove "$pytest_dir" ".pytest_cache directory"
done

# Clean mypy cache
find "$TARGET_DIR" -type d -name ".mypy_cache" 2>/dev/null | while read -r mypy_dir; do
    safe_remove "$mypy_dir" ".mypy_cache directory"
done

# Clean tox directories
find "$TARGET_DIR" -type d -name ".tox" 2>/dev/null | while read -r tox_dir; do
    safe_remove "$tox_dir" ".tox directory"
done

# Clean coverage files
echo "📊 Cleaning coverage files..."
find "$TARGET_DIR" -type f -name ".coverage" 2>/dev/null | while read -r cov_file; do
    safe_remove "$cov_file" ".coverage file"
done

find "$TARGET_DIR" -type f -name ".coverage.*" 2>/dev/null | while read -r cov_file; do
    safe_remove "$cov_file" ".coverage.* file"
done

# Clean .cache directories
echo "💾 Cleaning general cache directories..."
find "$TARGET_DIR" -type d -name ".cache" 2>/dev/null | while read -r cache_dir; do
    safe_remove "$cache_dir" ".cache directory"
done

# Clean node_modules cache (if exists)
find "$TARGET_DIR" -path "*/node_modules/.cache" -type d 2>/dev/null | while read -r node_cache; do
    safe_remove "$node_cache" "node_modules/.cache directory"
done

# Clean temporary editor files
echo "✏️  Cleaning temporary editor files..."
find "$TARGET_DIR" -type f \( -name "*.swp" -o -name "*.swo" -o -name "*~" -o -name "*.tmp" \) 2>/dev/null | while read -r temp_file; do
    safe_remove "$temp_file" "temporary file"
done

# Summary
echo ""
echo "✅ Cleanup complete!"

# Calculate total space that would be freed (works for both dry run and actual run)
total_space_kb=0

# Calculate space for each type of file/directory
for pycache_dir in $(find "$TARGET_DIR" -type d -name "__pycache__" 2>/dev/null); do
    if [ -d "$pycache_dir" ]; then
        size_kb=$(du -sk "$pycache_dir" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

for pyc_file in $(find "$TARGET_DIR" -type f -name "*.pyc" 2>/dev/null); do
    if [ -f "$pyc_file" ]; then
        size_kb=$(du -sk "$pyc_file" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

for pyo_file in $(find "$TARGET_DIR" -type f -name "*.pyo" 2>/dev/null); do
    if [ -f "$pyo_file" ]; then
        size_kb=$(du -sk "$pyo_file" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

for ds_file in $(find "$TARGET_DIR" -type f -name ".DS_Store" 2>/dev/null); do
    if [ -f "$ds_file" ]; then
        size_kb=$(du -sk "$ds_file" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

for cache_dir in $(find "$TARGET_DIR" -type d \( -name ".pytest_cache" -o -name ".mypy_cache" -o -name ".tox" -o -name ".cache" \) 2>/dev/null); do
    if [ -d "$cache_dir" ]; then
        size_kb=$(du -sk "$cache_dir" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

for cov_file in $(find "$TARGET_DIR" -type f -name ".coverage*" 2>/dev/null); do
    if [ -f "$cov_file" ]; then
        size_kb=$(du -sk "$cov_file" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

for temp_file in $(find "$TARGET_DIR" -type f \( -name "*.swp" -o -name "*.swo" -o -name "*~" -o -name "*.tmp" \) 2>/dev/null); do
    if [ -f "$temp_file" ]; then
        size_kb=$(du -sk "$temp_file" 2>/dev/null | cut -f1)
        total_space_kb=$((total_space_kb + size_kb))
    fi
done

# Convert KB to human readable format
if [ $total_space_kb -gt 1048576 ]; then
    # Greater than 1GB
    gb_whole=$((total_space_kb / 1048576))
    gb_remainder=$(((total_space_kb % 1048576) * 10 / 1048576))
    space_human="${gb_whole}.${gb_remainder}GB"
elif [ $total_space_kb -gt 1024 ]; then
    # Greater than 1MB  
    mb_whole=$((total_space_kb / 1024))
    mb_remainder=$(((total_space_kb % 1024) * 10 / 1024))
    space_human="${mb_whole}.${mb_remainder}MB"
else
    # Less than 1MB
    space_human="${total_space_kb}KB"
fi

# Count items for summary
pycache_count=$(find "$TARGET_DIR" -type d -name "__pycache__" 2>/dev/null | wc -l)
pyc_count=$(find "$TARGET_DIR" -type f -name "*.pyc" 2>/dev/null | wc -l)
pyo_count=$(find "$TARGET_DIR" -type f -name "*.pyo" 2>/dev/null | wc -l)
ds_count=$(find "$TARGET_DIR" -type f -name ".DS_Store" 2>/dev/null | wc -l)
pytest_count=$(find "$TARGET_DIR" -type d -name ".pytest_cache" 2>/dev/null | wc -l)
mypy_count=$(find "$TARGET_DIR" -type d -name ".mypy_cache" 2>/dev/null | wc -l)
tox_count=$(find "$TARGET_DIR" -type d -name ".tox" 2>/dev/null | wc -l)
cache_count=$(find "$TARGET_DIR" -type d -name ".cache" 2>/dev/null | wc -l)
cov_count=$(find "$TARGET_DIR" -type f -name ".coverage*" 2>/dev/null | wc -l)
temp_count=$(find "$TARGET_DIR" -type f \( -name "*.swp" -o -name "*.swo" -o -name "*~" -o -name "*.tmp" \) 2>/dev/null | wc -l)

total_items=$((pycache_count + pyc_count + pyo_count + ds_count + pytest_count + mypy_count + tox_count + cache_count + cov_count + temp_count))

if [ "$DRY_RUN" = false ]; then
    if [ $total_items -gt 0 ]; then
        echo "🗑️  Cleaned $total_items items and freed $space_human of disk space!"
        echo "📁 Target: $TARGET_DIR"
    else
        echo "🎉 Directory was already clean!"
    fi
else
    if [ $total_items -gt 0 ]; then
        echo "📋 Would clean $total_items items and free $space_human of disk space:"
        [ $pycache_count -gt 0 ] && echo "   • $pycache_count __pycache__ directories"
        [ $pyc_count -gt 0 ] && echo "   • $pyc_count .pyc files"
        [ $pyo_count -gt 0 ] && echo "   • $pyo_count .pyo files"
        [ $ds_count -gt 0 ] && echo "   • $ds_count .DS_Store files"
        [ $pytest_count -gt 0 ] && echo "   • $pytest_count .pytest_cache directories"
        [ $mypy_count -gt 0 ] && echo "   • $mypy_count .mypy_cache directories"
        [ $tox_count -gt 0 ] && echo "   • $tox_count .tox directories"
        [ $cache_count -gt 0 ] && echo "   • $cache_count .cache directories"
        [ $cov_count -gt 0 ] && echo "   • $cov_count coverage files"
        [ $temp_count -gt 0 ] && echo "   • $temp_count temporary files"
        echo ""
        echo "Run without -n flag to actually clean these files and free the space."
    else
        echo "🎉 Directory is already clean!"
    fi
fi 