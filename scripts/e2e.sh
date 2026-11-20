#!/usr/bin/env bash
# `e2e.testCommand` for jott's factory gates (see .kanban-cli.json).
# Both runners judge a run by exit code only.
#
#   Local (no E2E_BASE_URL): lint, then build and test every package through Turborepo.
#     With `--grep <p>` only the tests whose name matches <p> run (vitest `-t <p>`),
#     and a pattern that matches no test fails.
#   Live (E2E_BASE_URL set): checks what the CI/CD release published to that registry,
#     via the `@smoke` spec in scripts/e2e/registry.e2e.ts
#     (`--grep <p>` → bun test `-t <p>`).
set -euo pipefail

cd "$(dirname "$0")/.."

grep_pattern=""
while [ $# -gt 0 ]; do
    case "$1" in
        --grep)
            grep_pattern="${2:?--grep needs a pattern}"
            shift 2
            ;;
        *)
            echo "e2e.sh: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

if [ -n "${E2E_BASE_URL:-}" ]; then
    exec bun test ./scripts/e2e/registry.e2e.ts --timeout 600000 ${grep_pattern:+-t "$grep_pattern"}
fi

if [ -n "$grep_pattern" ]; then
    log="$(mktemp)"
    trap 'rm -f "$log"' EXIT
    bun x turbo run test -- -t "$grep_pattern" 2>&1 | tee "$log"
    # vitest exits 0 when `-t` filters out every test; a gate that ran nothing must fail.
    if ! grep -qE 'Tests +([0-9]+ [a-z]+ \| )*[0-9]+ passed' "$log"; then
        echo "e2e.sh: no test matched --grep '$grep_pattern'" >&2
        exit 1
    fi
    exit 0
fi

bun run lint
bun x turbo run build test
echo "e2e.sh: lint, build and tests all passed"
