#!/bin/sh
set -eo pipefail

# Initialize variables to ensure they're always defined
NEW_VERSION="0.1.0"
MAJOR=0
MINOR=1
PATCH=0

# Initialize build.env early to ensure artifact exists
printf "VERSION=%s\nVERSION_TAG=v%s\n" "${NEW_VERSION}" "${NEW_VERSION}" > build.env

echo "🔍 Fetching tags from repository..."
git fetch https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git --tags --force || true

# Get latest tag matching v*; if none, fall back to root package.json version
LAST_TAG=$(git describe --tags --abbrev=0 --match "v*" 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  echo "📌 Last tag: $LAST_TAG"
  BASE=${LAST_TAG#v}
else
  if [ -f "package.json" ]; then
    BASE=$(jq -r '.version // "0.1.0"' package.json)
    # Validate that BASE is a valid semantic version format
    if ! echo "$BASE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      echo "⚠️  Invalid version in package.json: $BASE. Using default: 0.1.0"
      BASE="0.1.0"
    fi
    echo "📦 No tag found. Using package.json version: $BASE"
  else
    BASE="0.1.0"
    echo "⚠️  No tag or package.json found. Starting from: $BASE"
  fi
fi

# Parse version components with validation
IFS='.' read -r MAJOR MINOR PATCH <<EOF
$BASE
EOF

# Ensure all components are numeric
MAJOR=${MAJOR:-0}
MINOR=${MINOR:-0}
PATCH=${PATCH:-0}

# Determine version increment based on commit message
COMMIT_MESSAGE=$(git log -1 --pretty=%B)

if echo "$COMMIT_MESSAGE" | grep -qi "major"; then
  echo "🔼 Found 'major' in commit message, incrementing major version"
  MAJOR=$((MAJOR+1))
  MINOR=0
  PATCH=0
elif echo "$COMMIT_MESSAGE" | grep -qi "minor"; then
  echo "🔼 Found 'minor' in commit message, incrementing minor version"
  MINOR=$((MINOR+1))
  PATCH=0
else
  echo "🔼 No version keywords found, incrementing patch version"
  PATCH=$((PATCH+1))
fi

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Ensure tag uniqueness by incrementing patch until an unused tag is found
while git rev-parse -q --verify "refs/tags/v${NEW_VERSION}" >/dev/null 2>&1; do
  echo "⚠️  Tag v${NEW_VERSION} already exists, incrementing patch..."
  PATCH=$((PATCH+1))
  NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
done

echo "✨ New version: v${NEW_VERSION}"

# Update package.json with the new version if it exists
if [ -f "package.json" ]; then
  jq --arg ver "${NEW_VERSION}" '.version = $ver' package.json > package.json.tmp
  mv package.json.tmp package.json
  echo "📝 Updated package.json to version ${NEW_VERSION}"

  # Commit the version update
  git add package.json
  git commit -m "chore: bump version to v${NEW_VERSION} [skip ci]" || echo "No changes to commit"
fi

# Create and push the version tag and commit to the project repository
git tag "v${NEW_VERSION}"
echo "🏷️  Created tag v${NEW_VERSION}"

git push https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git HEAD:${CI_COMMIT_REF_NAME} --tags
echo "📤 Pushed tag and commit to repository"

# Export for downstream jobs
printf "VERSION=%s\nVERSION_TAG=v%s\n" "${NEW_VERSION}" "${NEW_VERSION}" > build.env

echo "✅ Version calculation complete: ${NEW_VERSION}"