#!/bin/bash
set -e

# Usage: docker-build.sh <service-name> <version> <dockerfile-path> <base-tag>
# Example: docker-build.sh kivo 1.7.1 ./Dockerfile kivo
# Example: docker-build.sh shoppingo 1.20.4 ./Dockerfile.api shoppingo-api

SERVICE_NAME=$1
VERSION=$2
DOCKERFILE_PATH=$3
BASE_TAG=$4

if [ -z "$SERVICE_NAME" ] || [ -z "$VERSION" ] || [ -z "$DOCKERFILE_PATH" ] || [ -z "$BASE_TAG" ]; then
  echo "❌ Usage: docker-build.sh <service-name> <version> <dockerfile-path> <base-tag>"
  exit 1
fi

if [ ! -f "$DOCKERFILE_PATH" ]; then
  echo "❌ Dockerfile not found: $DOCKERFILE_PATH"
  exit 1
fi

echo "🐳 Building $SERVICE_NAME:$VERSION from $DOCKERFILE_PATH"

# Build Docker image with versioned tag and latest tag
docker buildx build \
  --push \
  --file "$DOCKERFILE_PATH" \
  --tag "docker.io/igurusama/imapps:${BASE_TAG}-${VERSION}" \
  --tag "docker.io/igurusama/imapps:${BASE_TAG}-latest" \
  --platform linux/amd64 \
  --build-arg NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN}" \
  --cache-from "type=gha" \
  --cache-to "type=gha,mode=max" \
  .

echo "✅ Successfully built and pushed:"
echo "  - docker.io/igurusama/imapps:${BASE_TAG}-${VERSION}"
echo "  - docker.io/igurusama/imapps:${BASE_TAG}-latest"
