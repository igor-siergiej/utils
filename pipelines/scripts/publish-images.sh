#!/bin/bash
set -e

# Usage: publish-images.sh <service-name> <version>
# Expects a config file at utils/pipelines/config/<service-name>.json

SERVICE_NAME=$1
VERSION=$2
UTILS_PIPELINES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$UTILS_PIPELINES_DIR/config/${SERVICE_NAME}.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Config file not found: $CONFIG_FILE"
  exit 1
fi

echo "🚀 Publishing images for $SERVICE_NAME:$VERSION"

# Parse config and build each Dockerfile
while IFS= read -r dockerfile_entry; do
  DOCKERFILE_PATH=$(echo "$dockerfile_entry" | jq -r '.dockerfile')
  BASE_TAG=$(echo "$dockerfile_entry" | jq -r '.tag')

  if [ -z "$DOCKERFILE_PATH" ] || [ -z "$BASE_TAG" ]; then
    echo "⚠️  Skipping invalid config entry"
    continue
  fi

  echo "📦 Building $DOCKERFILE_PATH -> $BASE_TAG"

  "$UTILS_PIPELINES_DIR/scripts/docker-build.sh" \
    "$SERVICE_NAME" \
    "$VERSION" \
    "$DOCKERFILE_PATH" \
    "$BASE_TAG"

done < <(jq -c '.dockerfiles[]' "$CONFIG_FILE")

echo "✅ All images published successfully"
