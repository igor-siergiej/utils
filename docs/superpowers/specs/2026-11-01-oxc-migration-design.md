# Biome -> Oxlint/Oxfmt migration with anti-slop

## Goal
Replace Biome with Oxlint (lint) + Oxfmt (format) in `utils` and `kivo`, and enforce the
[anti-slop](https://github.com/dmmulroy/anti-slop) ruleset so agents are held to it via the existing `lint` CI gate.

## Decisions (approved)
- Formatter: **oxfmt** (Prettier-baseline output, built-in `sortImports`).
- Backlog: every repo's migration PR **fixes all violations** (rules at `error`), no baselines.
- Packaging: new **`@imapps/oxc-config`** in `utils/packages/oxc-config` replaces `@imapps/biome-config`.
  anti-slop is vendored inside it (upstream: no npm package, meant to be vendored). Effect rule group omitted (no repo uses `effect`).
- Scope: **utils + kivo only**. Other repos keep Biome; `@imapps/biome-config` stays published, marked deprecated.

## Package contract
`@imapps/oxc-config` exports:
- `./oxlint` -> `oxlintConfig` object (spread into `defineConfig` in a repo's `oxlint.config.ts`)
- `./oxfmt`  -> `oxfmtConfig` object (re-exported from a repo's `oxfmt.config.ts`)
- anti-slop plugin lives at `anti-slop/index.ts`, referenced by `jsPlugins` specifier `@imapps/oxc-config/anti-slop`.
Exact-pinned (same version) `oxlint` + `@oxlint/plugins`; pinned `oxfmt`. JS plugins are alpha, not semver.

Formatting parity with Biome base: 4-space indent, width 120, single quotes, semicolons, `es5` trailing commas,
`always` arrow parens, JSON 2-space, `sortImports` on.

Lint parity: `correctness` category, `jsx-a11y`, `prefer-const`, `prefer-template`, `eqeqeq` (warn),
`typescript/no-explicit-any` (warn; off in `*.test.*`/`*.spec.*`), `oxc/no-accumulating-spread`, all 18 generic anti-slop rules `error`.
Ignore: agent dirs (`.claude .omp .pi .agents .cursor ...`), `.worktrees`, `node_modules`, vendored plugin dir.

## Repo wiring (utils, kivo)
- scripts keep names: `lint` = `oxlint && oxfmt --check`; `lint:fix` = `oxlint --fix && oxfmt && oxlint`; `format` = `oxfmt`.
- lint-staged runs the fix pipeline; CI job names (`lint`, `test`) unchanged so the kanban-cli gate keeps working.
- Docs saying "Biome" updated (`utils/CLAUDE.md`, `utils/README.md`, `kivo/CLAUDE.md`); both CLAUDE.md gain an agent instruction to run `bun run lint:fix` and fix (not suppress) anti-slop violations.
- Order: utils (build + release package) -> kivo (consumes released version).

## Risks
- Plugin runtime under Bun (verify in Task 2 before anything else).
- anti-slop `no-unknown-*`/`no-runtime-typeof` may force boundary-parsing refactors in kivo.
- Reformat churn: isolated in its own commit per repo.
