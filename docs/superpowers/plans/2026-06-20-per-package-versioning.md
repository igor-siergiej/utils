# Per-package auto-versioning (multi-semantic-release) Plan

Branch: `feat/hono-api-utils` (same branch as the Hono api-utils work, per decision).
Goal: each utils workspace package gets its own semantic-release version/tag from
commits scoped to its path, and `@semantic-release/npm` publishes it directly.
Retire the manual `scripts/publish-packages.sh` + `publish-npm` CI job.

## Decisions (locked)
- Tool: `@qiwi/multi-semantic-release` (MSR) — discovers packages via root
  `workspaces`, default tag format `${name}@${version}`, shared root config
  merged per package.
- Publish: `@semantic-release/npm` (npmPublish: true) inside the release run.
  Delete `scripts/publish-packages.sh` and the `publish-npm` job.
- Platform: GitHub (real remote `github.com/igor-siergiej/utils`). Remove stale
  GitLab refs from root `package.json`.

## Baseline state
Published (npm) = baseline tags to seed:
`@imapps/api-utils@0.5.1`, `@imapps/web-utils@0.5.1`,
`@imapps/biome-config@0.5.1`, `@imapps/dev-scripts@0.1.0`.
Branch base commit (= last main state): `c7278d9`.
All 4 packages are publishable (api-utils/web-utils build to `build/`;
biome-config/dev-scripts ship files as-is).

## Tasks

### V1 — Seed per-package baseline tags (local; pushed at merge)
Create annotated tags at `c7278d9` so MSR computes next versions from them:
- `@imapps/api-utils@0.5.1`
- `@imapps/web-utils@0.5.1`
- `@imapps/biome-config@0.5.1`
- `@imapps/dev-scripts@0.1.0`
These must be pushed with the branch/PR so CI sees them. Do NOT push here.

### V2 — Deps + config
- Root `package.json`:
  - devDeps: add `@qiwi/multi-semantic-release`, `@semantic-release/npm`;
    remove stale `@semantic-release/gitlab`.
  - `repository.url` → `https://github.com/igor-siergiej/utils.git`.
  - scripts: `release` → `multi-semantic-release`,
    `release:dry` → `multi-semantic-release --dry-run --no-ci`.
- `.releaserc.json` (shared, MSR merges per package): plugin order
  commit-analyzer → release-notes-generator → changelog → **npm (npmPublish
  true)** → git → github. `@semantic-release/git` assets become per-package
  relative: `["package.json", "CHANGELOG.md"]`.
- `bun install` to refresh lockfile.

### V3 — CI
- `.github/workflows/ci-cd.yml`:
  - release job: `bunx semantic-release` → `bunx multi-semantic-release`; add
    npm auth (`.npmrc` with `NPM_TOKEN`, `NODE_AUTH_TOKEN` env) since publish now
    happens here.
  - Delete the `publish-npm` job.
- Delete `scripts/publish-packages.sh`.

### V4 — Validate (gate)
`bunx multi-semantic-release --dry-run --no-ci` with the local baseline tags.
Expected: `@imapps/api-utils` → next `0.6.0` (feat commits since 0.5.1);
web-utils/biome-config/dev-scripts → no release (no scoped changes). If the
github plugin blocks dry-run without a token, confirm version computation from
MSR log output instead.

## Stop boundary
Execute V1–V4 on the branch. Do NOT push tags or publish — those happen when the
PR merges to `main` (CI). Report dry-run results for review.

## Risks
- MSR runs under bun spawning node semantic-release — verify it executes.
- `@semantic-release/git` per-package commits during one MSR run — MSR sequences
  these; watch for commit conflicts in dry-run.
- biome-config/dev-scripts have no build; `@semantic-release/npm` publishes their
  `files` as-is — fine, but confirm no prepack assumptions.
