#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Validate inputs
if [[ -z "${IMAGE:-}" ]]; then
  log_error "IMAGE environment variable not set"
  exit 1
fi

if [[ -z "${TAG_PREFIX:-}" ]]; then
  log_error "TAG_PREFIX environment variable not set"
  exit 1
fi

if [[ -z "${DOCKER_USERNAME:-}" ]] || [[ -z "${DOCKER_PASSWORD:-}" ]]; then
  log_error "DOCKER_USERNAME or DOCKER_PASSWORD not set"
  exit 1
fi

KEEP_COUNT=${KEEP_COUNT:-5}

log_info "Cleaning up Docker Hub registry for: $IMAGE"
log_info "Tag prefix: $TAG_PREFIX"
log_info "Keeping latest $KEEP_COUNT versions plus '${TAG_PREFIX}-latest' tag"

# Step 1: Get Docker Hub API token
log_info "Authenticating with Docker Hub..."
TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$DOCKER_USERNAME\",\"password\":\"$DOCKER_PASSWORD\"}" \
  https://hub.docker.com/v2/users/login | jq -r '.token')

if [[ -z "$TOKEN" ]] || [[ "$TOKEN" == "null" ]]; then
  log_error "Failed to obtain Docker Hub API token"
  exit 1
fi

log_info "Authentication successful"

# Step 2: Get list of all tags
log_info "Fetching tags from Docker Hub..."
RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://hub.docker.com/v2/repositories/$IMAGE/tags/?page_size=100")

# Check if image exists
if echo "$RESPONSE" | jq -e '.detail' >/dev/null 2>&1; then
  log_error "Image not found: $IMAGE"
  exit 1
fi

# Extract tag names and filter for prefix-based semver versions
TAGS=$(echo "$RESPONSE" | jq -r '.results[].name' | grep -E "^${TAG_PREFIX}-[0-9]+\.[0-9]+\.[0-9]+" | sort -V -r || true)

if [[ -z "$TAGS" ]]; then
  log_warn "No tags found with prefix '$TAG_PREFIX' for $IMAGE"
  exit 0
fi

# Step 3: Identify tags to delete
TAGS_ARRAY=($TAGS)
TAGS_TO_KEEP=("${TAGS_ARRAY[@]:0:$KEEP_COUNT}")

log_info "Found ${#TAGS_ARRAY[@]} total versions with prefix '$TAG_PREFIX'"
log_info "Keeping latest $KEEP_COUNT versions:"
for tag in "${TAGS_TO_KEEP[@]}"; do
  log_info "  - $tag"
done

# Always keep '{prefix}-latest' tag
log_info "Always keeping '${TAG_PREFIX}-latest' tag"

# Step 4: Delete old tags
DELETED_COUNT=0
for tag in "${TAGS_ARRAY[@]}"; do
  if [[ ! " ${TAGS_TO_KEEP[@]} " =~ " ${tag} " ]] && [[ "$tag" != "${TAG_PREFIX}-latest" ]]; then
    log_info "Deleting tag: $tag"

    DELETE_RESPONSE=$(curl -s -X DELETE \
      -H "Authorization: Bearer $TOKEN" \
      "https://hub.docker.com/v2/repositories/$IMAGE/tags/$tag/")

    if [[ -z "$DELETE_RESPONSE" ]] || echo "$DELETE_RESPONSE" | jq -e '.detail' >/dev/null 2>&1; then
      log_info "Successfully deleted: $tag"
      ((DELETED_COUNT++))
    else
      log_warn "Failed to delete tag: $tag"
    fi

    # Rate limiting - small delay between deletes
    sleep 0.5
  fi
done

log_info "Cleanup complete. Deleted $DELETED_COUNT old tags."
log_info "Image $IMAGE now has ${#TAGS_TO_KEEP[@]} kept versions + ${TAG_PREFIX}-latest tag"
