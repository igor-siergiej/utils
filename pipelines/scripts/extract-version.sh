#!/bin/bash
set -e

# Extract version from package.json in current directory
VERSION=$(node -p "require('./package.json').version")

if [ -z "$VERSION" ]; then
  echo "❌ Failed to extract version from package.json"
  exit 1
fi

echo "VERSION=$VERSION"

# For GitHub Actions
if [ ! -z "$GITHUB_OUTPUT" ]; then
  echo "version=$VERSION" >> "$GITHUB_OUTPUT"
fi
