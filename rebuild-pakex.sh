#!/bin/bash
set -e

echo "=== Rebuilding pakex CLI ==="

cd "$(dirname "$0")"

echo "[1/3] Building CLI TypeScript..."
pnpm run cli:build

echo "[2/3] Building Tauri app..."
# Set environment variable to prevent auto-opening DMG on macOS
export APPLE_NO_AUTO_OPEN_DMGS=true
pnpm run build

echo "[3/3] Installing pakex globally..."
npm install -g .

echo ""
echo "=== pakex rebuild complete ==="
pakex --version

# Unmount any mounted DMGs to clean up
if command -v hdiutil &> /dev/null; then
  hdiutil info | grep "/dev/disk" | awk '{print $1}' | while read disk; do
    hdiutil detach "$disk" 2>/dev/null || true
  done
fi
