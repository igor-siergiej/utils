#!/bin/bash
set -euo pipefail

# Configuration
BUN_VERSION="1.1.38"
# Default to TrueNAS registry IP (192.168.68.59:5000)
# Can override with: REGISTRY_URL=custom.registry.com:5000 ./build-and-push-bun-git.sh
PRIVATE_REGISTRY="${REGISTRY_URL:-192.168.68.59:5000}"
IMAGE_NAME="bun-git"
FULL_IMAGE_TAG="${PRIVATE_REGISTRY}/${IMAGE_NAME}:${BUN_VERSION}"
LATEST_TAG="${PRIVATE_REGISTRY}/${IMAGE_NAME}:latest"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🐳 Building custom Bun image with git..."
echo "   Base: oven/bun:${BUN_VERSION}"
echo "   Target: ${FULL_IMAGE_TAG}"
echo ""

# Build the image
docker build \
  --build-arg BUN_VERSION="${BUN_VERSION}" \
  -f "${SCRIPT_DIR}/bun-git.Dockerfile" \
  -t "${FULL_IMAGE_TAG}" \
  -t "${LATEST_TAG}" \
  "${SCRIPT_DIR}"

echo ""
echo "✅ Build completed successfully!"
echo ""
echo "📤 Pushing to registry..."

# Push both tags
docker push "${FULL_IMAGE_TAG}"
docker push "${LATEST_TAG}"

echo ""
echo "🎉 Successfully pushed:"
echo "   - ${FULL_IMAGE_TAG}"
echo "   - ${LATEST_TAG}"
echo ""
echo "💡 Update your templates.yml to use: ${PRIVATE_REGISTRY}/${IMAGE_NAME}:\${BUN_VERSION}"
