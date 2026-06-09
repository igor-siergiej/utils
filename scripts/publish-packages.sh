#!/usr/bin/env bash
# Publishes every non-private workspace package whose current version is not yet
# on the registry. Idempotent: re-running without a version bump is a no-op, so
# unchanged packages don't fail the job and new packages publish on their own.
# Bun-native: uses `bun publish` and a registry HTTP check (no npm).
set -euo pipefail

REGISTRY="https://registry.npmjs.org"
published=0
skipped=0

already_published() {
    # Registry path encodes the scope slash as %2f, e.g. @imapps%2fdev-scripts.
    local name="$1" version="$2"
    local encoded="${name/\//%2f}"
    curl -fsSL -o /dev/null "$REGISTRY/$encoded/$version" 2>/dev/null
}

for manifest in packages/*/package.json; do
    dir="$(dirname "$manifest")"
    name="$(jq -r '.name' "$manifest")"
    version="$(jq -r '.version' "$manifest")"
    private="$(jq -r '.private // false' "$manifest")"

    if [ "$private" = "true" ] || [ "$name" = "null" ]; then
        echo "skip $dir (private or unnamed)"
        continue
    fi

    if already_published "$name" "$version"; then
        echo "skip $name@$version (already published)"
        skipped=$((skipped + 1))
        continue
    fi

    echo "publishing $name@$version"
    (cd "$dir" && bun publish)
    published=$((published + 1))
done

echo "published $published package(s), skipped $skipped"
