# utils

Shared packages, CI scripts and local dev infra for the IM Apps repos. Bun workspaces + turbo; GitHub `igor-siergiej/utils`.

Architecture: [docs/diagrams/architecture.excalidraw](docs/diagrams/architecture.excalidraw) (open in excalidraw.com or the VS Code Excalidraw extension).

## Packages (`packages/*`, published to npmjs.org)

| Package | What | Used by |
| --- | --- | --- |
| [`@imapps/api-utils`](packages/api-utils/README.md) | Config, logger, DI container, Mongo + S3 object store connections; `./hono` app factory, CORS, request logging, error handler | `packages/api` of shoppingo, mixtape, jewellery-catalogue, imapps-template; kivo |
| [`@imapps/web-utils`](packages/web-utils/README.md) | React JWT auth: providers, `ProtectedRoute`, token hooks/utils | `packages/web` of shoppingo, mixtape, jewellery-catalogue |
| [`@imapps/oxc-config`](packages/oxc-config/README.md) | Shared Oxlint + Oxfmt config with vendored anti-slop rules | this repo, kivo |
| [`@imapps/dev-scripts`](packages/dev-scripts/README.md) | `fallow-audit` bin (dead-code/complexity audit, same as CI) | most app and site repos |

"Used by" is a scan of `/home/home/imapps/*/package.json` (and `packages/*`), not exhaustive; `jc-*` checkouts are jewellery-catalogue branch clones.

### Retired Biome configuration

The deprecated `@imapps/biome-config` source workspace has been removed. Existing npm versions remain downloadable for old checkouts and outside consumers; do not unpublish them or recreate the old package name. Use [`@imapps/oxc-config`](packages/oxc-config/README.md) for maintained shared lint/format presets.

Consumer recheck (2026-11-20, utils #399):

- Inspected this utils worktree's manifests, configs, build/release/publish scripts and documentation. No remaining workspace depends on or imports the retired preset.
- The mounted `/home/home/imapps` inventory contains only utils and a partial jott runner checkout. The accessible jott files contain no `@imapps/biome-config` dependency/import; no jott package manifests or Biome configs are mounted. No other application checkout was available.
- The former inventory row claimed shoppingo and tandra used the shared preset. Neither checkout is mounted. Attempts to read their current `main/package.json` via raw GitHub, list GitHub repositories, and query the Forgejo repository inventory were denied (HTTP 403); GitHub CLI has no token, and shoppingo SSH access failed on the system SSH config permissions. Their current dependencies/configs could not be verified. The old row is not evidence of a live consumer.
- The card's earlier remote-main audit reported no shared-preset consumers in accessible active projects, but that result was not independently reproduced here. This recheck found no live consumer in the accessible scope; it does **not** establish that all projects, shoppingo, tandra or outside consumers are migrated. Existing published versions are retained rather than breaking those unverified consumers. Other repositories' standalone Biome installations are outside this change.

Retention check on the same date: all 23 versions listed by the [npm registry](https://registry.npmjs.org/@imapps%2fbiome-config), from `0.5.1` through `7.0.1`, were downloaded read-only and matched their registry SHA-1 checksums. No publish, deprecation or unpublish operation was performed.

Task automation lives in [jott's factory runner](https://git.imapps.uk/igor/jott/src/branch/main/runner), maintained in the jott repository.

## Versioning and publishing

All packages share one version (lockstep), driven by semantic-release on `main`:

1. `.github/workflows/ci-cd.yml`: `lint` → `test` → `release` → `publish-npm` (release/publish on push only).
2. `release`: `bunx semantic-release` (`.releaserc.json`, angular preset; `release:` commit type = major). `scripts/stamp-versions.mjs` writes the next version into root + every `packages/*/package.json`, then commits `chore(release): x.y.z [skip ci]` with `CHANGELOG.md` and a `vX.Y.Z` tag.
3. `publish-npm`: `bun run build`, then `scripts/publish-packages.sh` publishes each non-private package whose version is not yet on npmjs.org (idempotent). Needs secret `NPM_TOKEN` (see [GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md)).

Per-package versioning (multi-semantic-release) is **not implemented**: there is no MSR dependency, tags are repo-wide `vX.Y.Z`, and `publish-packages.sh` still exists.

## CI assets for consumer repos

- [`pipelines/`](pipelines/README.md): `publish-images.sh`, `docker-build.sh`, `extract-version.sh` + per-service `pipelines/config/*.json`. Consumers add this repo as a git submodule at `.github/workflows-utils` and call `pipelines/scripts/publish-images.sh` from their CI (shoppingo `cd.yml`; kivo, mixtape, jewellery-catalogue, imapps-template `ci-cd.yml`).
- `.github/actions/cleanup-docker-hub`: composite action pruning old Docker Hub tags (keeps 5 + `latest`); see its `USAGE.md`. Referenced as `igurusama/utils/.github/actions/cleanup-docker-hub@main`.
- `.github/workflows/reusable-{lint-test,release,docker-build-publish}.yml`: `workflow_call` workflows. No consumer repo under `/home/home/imapps` currently `uses:` them.
- `templates.yml`: deprecated GitLab CI templates (kept for reference; header says so).

## Local dev

```sh
bun install
bun run build      # turbo run build
bun run test       # turbo run test
bun run lint       # build oxc-config, then oxlint && oxfmt --check
bun run release:dry
```

The `oxc-config` consumer tests have a 30-second per-test timeout: they run real CLI subprocesses, and the nested Turbo build-graph check can exceed Vitest's default 5 seconds on a cold start.

Husky + lint-staged run `oxlint --fix` and `oxfmt` on staged files on commit (the hook builds `@imapps/oxc-config` first).

`docker/docker-compose.yml` provides shared dev backing services, bound to `127.0.0.1`: MongoDB 7 (`27017`), RustFS S3-compatible object store (`9000`, console `9001`, creds `rustfsadmin`/`rustfsadmin`) with buckets created for jewellery-catalogue and shoppingo, and Navidrome (`4533`) reading `../../mixtape/music`. Credentials are dev-only placeholders in the compose file.

`docker/bun-git.Dockerfile` + `build-and-push-bun-git.sh` build a Bun + git CI image for the old GitLab setup (default registry `192.168.68.59:5000`); not referenced by current GitHub workflows.

## Factory gates (`jott-config.json`)

`jott-config.json` (`repoName: utils`) configures this repo's gates for jott's factory runner. This replaces `.kanban-cli.json`; the runner does not fall back to the old filename. utils is a library monorepo, so each gate maps to the nearest real step:

| Gate | Runs |
| --- | --- |
| `e2e local` | `scripts/e2e-server.ts` only answers the gate's health poll on `127.0.0.1:8798`. Then `scripts/e2e.sh` runs `bun run lint` and `turbo run build test`. With `--grep <p>`, only tests matching `<p>` run (vitest `-t <p>`), and a pattern that matches no test fails. |
| `ci` | PR run of workflow `CI/CD`; required checks `lint`, `test` |
| `deploy` | push-to-main run of `CI/CD` for the merge commit (semantic-release, then `publish-npm`) |
| `e2e live` | `scripts/e2e.sh` with `E2E_BASE_URL=https://registry.npmjs.org` runs the `@smoke` spec in `scripts/e2e/registry.e2e.ts` with `bun test`. It checks that every public package on `origin/main` is on the registry at its version. It waits up to `E2E_PUBLISH_WAIT_S` (default 300) for the registry, and only reads from it. |
