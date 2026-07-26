#!/bin/bash
set -e

echo "=== Uninstalling pakex CLI ==="
echo ""

# Step 1: Uninstall npm global package
echo "[1/4] Removing npm global package..."
if npm list -g pake-cli &> /dev/null; then
    npm uninstall -g pake-cli
    echo "✓ Removed pake-cli from npm global packages"
else
    echo "ℹ pake-cli not found in npm global packages"
fi

# Also try uninstalling as 'pakex' if it was installed that way
if npm list -g pakex &> /dev/null; then
    npm uninstall -g pakex
    echo "✓ Removed pakex from npm global packages"
else
    echo "ℹ pakex not found in npm global packages"
fi

# Step 2: Remove any残留的 CLI binaries
echo ""
echo "[2/4] Cleaning up CLI binaries..."
CLI_PATHS=(
    "/usr/local/bin/pakex"
    "/usr/local/bin/pake-cli"
    "/opt/homebrew/bin/pakex"
    "/opt/homebrew/bin/pake-cli"
)

for path in "${CLI_PATHS[@]}"; do
    if [ -f "$path" ]; then
        rm -f "$path"
        echo "✓ Removed $path"
    fi
done

# Step 3: Remove npm global cache
echo ""
echo "[3/4] Cleaning npm cache..."
npm cache clean --force 2>/dev/null || true
echo "✓ npm cache cleaned"

# Step 4: Remove any Pake apps from Applications
echo ""
echo "[4/4] Checking for Pake apps in Applications..."
PAKE_APPS=(
    "/Applications/Weekly.app"
    "/Applications/Pake.app"
    "$HOME/Applications/Weekly.app"
    "$HOME/Applications/Pake.app"
)

for app in "${PAKE_APPS[@]}"; do
    if [ -d "$app" ]; then
        rm -rf "$app"
        echo "✓ Removed $app"
    fi
done

# Summary
echo ""
echo "=== Uninstall complete ==="
echo ""
echo "Note: This script does NOT remove:"
echo "  - Apps you created with pakex (check ~/Applications or /Applications)"
echo "  - Build artifacts in this project (run 'pnpm clean' if needed)"
echo "  - Tauri build cache (src-tauri/target/)"
echo ""
echo "To verify removal:"
echo "  pakex --version    # Should show 'command not found'"
echo "  which pakex        # Should return empty"
