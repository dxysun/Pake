#!/bin/bash
set -e

echo "=== Testing pakex icon conversion ==="

cd "$(dirname "$0")"

# Create a test PNG icon (100x100 red square)
mkdir -p /tmp/pake-test
convert -size 100x100 xc:red /tmp/pake-test/test-icon.png

echo "✓ Created test PNG icon"

# Test packaging with PNG icon (this will convert to .icns on macOS)
echo "Testing pakex with PNG icon..."
./rebuild-pakex.sh

echo ""
echo "=== Test complete ==="
echo "You can now test with:"
echo "  pakex https://example.com --icon /tmp/pake-test/test-icon.png --name TestApp"
