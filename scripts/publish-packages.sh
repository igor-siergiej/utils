#!/usr/bin/env bash
# Publishes every non-private workspace package whose current version is not yet
# on the registry. Idempotent: re-running without a version bump is a no-op, so
# unchanged packages don't fail the job and new packages publish on their own.
set -euo pipefail

published=0
skipped=0

for manifest in packages/*/package.json; do
    dir="$(dirname "$manifest")"
    name="$(jq -r '.name' "$manifest")"
    version="$(jq -r '.version' "$manifest")"
    private="$(jq -r '.private // false' "$manifest")"

    if [ "$private" = "true" ] || [ "$name" = "null" ]; then
        echo "skip $dir (private or unnamed)"
        continue
    fi

    if npm view "$name@$version" version >/dev/null 2>&1; then
        echo "skip $name@$version (already published)"
        skipped=$((skipped + 1))
        continue
    fi

    echo "publishing $name@$version"
    (cd "$dir" && npm publish)
    published=$((published + 1))
done

echo "published $published package(s), skipped $skipped"
