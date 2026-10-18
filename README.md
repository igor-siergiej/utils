# utils

Shared packages, CI scripts and local dev infra for the IM Apps repos. Bun workspaces + turbo; GitHub `igor-siergiej/utils`.

Architecture: [docs/diagrams/architecture.excalidraw](docs/diagrams/architecture.excalidraw) (open in excalidraw.com or the VS Code Excalidraw extension).

## Packages (`packages/*`, published to npmjs.org)

| Package | What | Used by |
| --- | --- | --- |
| [`@imapps/api-utils`](packages/api-utils/README.md) | Config, logger, DI container, Mongo + MinIO connections; `./hono` app factory, CORS, request logging, error handler | `packages/api` of shoppingo, mixtape, jewellery-catalogue, imapps-template; kivo |
| [`@imapps/web-utils`](packages/web-utils/README.md) | React JWT auth: providers, `ProtectedRoute`, token hooks/utils | `packages/web` of shoppingo, mixtape, jewellery-catalogue |
| [`@imapps/biome-config`](packages/biome-config/README.md) | Shared Biome config | kivo, shoppingo, this repo |
| [`@imapps/dev-scripts`](packages/dev-scripts/README.md) | `fallow-audit` bin (dead-code/complexity audit, same as CI) | most app and site repos |
| [`@imapps/kanban-cli`](packages/kanban-cli/README.md) | CLI + `kanban-worker` Claude Code skill for markdown kanban boards | installed globally (`bun add -g`) |

"Used by" is a scan of `/home/home/imapps/*/package.json` (and `packages/*`), not exhaustive; `jc-*` checkouts are jewellery-catalogue branch clones.

## Versioning and publishing

All packages share one version (lockstep), driven by semantic-release on `main`:

1. `.github/workflows/ci-cd.yml`: `lint` → `test` → `release` → `publish-npm` (release/publish on push only).
2. `release`: `bunx semantic-release` (`.releaserc.json`, angular preset; `release:` commit type = major). `scripts/stamp-versions.mjs` writes the next version into root + every `packages/*/package.json`, then commits `chore(release): x.y.z [skip ci]` with `CHANGELOG.md` and a `vX.Y.Z` tag.
3. `publish-npm`: `bun run build`, then `scripts/publish-packages.sh` publishes each non-private package whose version is not yet on npmjs.org (idempotent). Needs secret `NPM_TOKEN` (see [GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md)).

The per-package versioning plan (`docs/superpowers/plans/2026-06-20-per-package-versioning.md`, multi-semantic-release) is **not implemented**: there is no MSR dependency, tags are repo-wide `vX.Y.Z`, and `publish-packages.sh` still exists.

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
bun run lint       # biome check .
bun run release:dry
```

Husky + lint-staged run `biome check --fix` on commit.

`docker/docker-compose.yml` provides shared dev backing services, bound to `127.0.0.1`: MongoDB 7 (`27017`), MinIO (`9000`, console `7001`) with buckets created for jewellery-catalogue and shoppingo, and Navidrome (`4533`) reading `../../mixtape/music`. Credentials are dev-only placeholders in the compose file.

`docker/bun-git.Dockerfile` + `build-and-push-bun-git.sh` build a Bun + git CI image for the old GitLab setup (default registry `192.168.68.59:5000`); not referenced by current GitHub workflows.
