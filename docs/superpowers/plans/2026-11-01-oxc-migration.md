# Biome -> Oxlint/Oxfmt + anti-slop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `utils` and `kivo` lint with Oxlint + anti-slop and format with Oxfmt, via a new shared `@imapps/oxc-config` package.

**Architecture:** New workspace package `utils/packages/oxc-config` exports oxlint/oxfmt base configs and a vendored, built anti-slop plugin. `utils` consumes it via the workspace; `kivo` consumes the released npm version. Script names and CI job names stay unchanged.

**Tech Stack:** oxlint, @oxlint/plugins (exact same version), oxfmt, bun workspaces, tsup, husky + lint-staged, semantic-release.

**Spec:** `docs/superpowers/specs/2026-11-01-oxc-migration-design.md`

## Global Constraints

- `oxlint` and `@oxlint/plugins` pinned to the SAME exact version (no `^`); at plan time `npm view` gives oxlint 1.90.0, @oxlint/plugins 1.90.0, oxfmt 0.75.0. Re-run `npm view` at execution and use current values.
- Formatting parity: indent 4 spaces, width 120, single quotes, JSX double quotes, semicolons, trailing commas `es5`, arrow parens always, JSON indent 2, sortImports on.
- All 18 generic anti-slop rules + `oxc/no-accumulating-spread` at `error`. Effect rule group NOT vendored.
- No suppressions (`oxlint-disable`) to get green; fix violations. Exception requires user approval.
- Script names `lint`, `lint:fix`, `format` and CI job names `lint`, `test` unchanged.
- Keep anti-slop MIT `LICENSE`, `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md`; record upstream commit `13909c9e07590f5a85d93c62712259fe14a883f7`.
- Scope: `utils`, `kivo` only. Do not touch other repos. `@imapps/biome-config` stays, marked deprecated.
- Reformat commit is separate from rule-fix commits.

---

### Task 1: Spike - plugin runs under Bun and from node_modules

Decides packaging of the plugin (raw `.ts` vs built `.js`). Throwaway dir `/tmp/oxc-spike`, nothing committed.

**Files:** none in repo.

**Produces:** a recorded answer: does `oxlint` load a `jsPlugins` specifier that is (a) a `.ts` file, (b) a `.ts` file inside `node_modules`, (c) a built `.js` file, when invoked via `bun run`/`bunx`?

- [ ] **Step 1: Set up spike**

```bash
rm -rf /tmp/oxc-spike && mkdir /tmp/oxc-spike && cd /tmp/oxc-spike
V=$(npm view oxlint version) && bun init -y >/dev/null
bun add -d oxlint@$V @oxlint/plugins@$V
git clone -q https://github.com/dmmulroy/anti-slop /tmp/as-src 2>/dev/null || true
node /tmp/as-src/skills/install-anti-slop/scripts/install.mjs tools/anti-slop
cat > oxlint.config.ts <<'EOF'
import { defineConfig } from 'oxlint';
export default defineConfig({
  jsPlugins: [{ name: 'anti-slop', specifier: './tools/anti-slop/index.ts' }],
  rules: { 'anti-slop/no-unknown-parameters': 'error' },
});
EOF
printf 'export function f(x: unknown) { return x; }\n' > bad.ts
```

- [ ] **Step 2: Run (a)** `bunx oxlint bad.ts`. Expected: reports `anti-slop/no-unknown-parameters`. Record pass/fail.
- [ ] **Step 3: Run (b)** move `tools/anti-slop` to `node_modules/@x/anti-slop`, point specifier at `@x/anti-slop/index.ts`, rerun. Record.
- [ ] **Step 4: Run (c)** `bunx tsup tools/anti-slop/index.ts --format esm --external @oxlint/plugins` (adjust path after step 3), point specifier at built `index.js`, rerun. Record.
- [ ] **Step 5: Decide.** If (b) fails and (c) passes, Task 2 builds the plugin with tsup and the package exports built JS. If (b) passes, ship raw `.ts`. If both fail, STOP and report to user (plugin cannot be shared via package; fall back to vendoring per repo).

---

### Task 2: Create `@imapps/oxc-config` package

**Files:**
- Create: `packages/oxc-config/package.json`
- Create: `packages/oxc-config/src/oxlint.ts`, `src/oxfmt.ts`
- Create: `packages/oxc-config/anti-slop/**` (copy of upstream assets; remove `effect/` dir)
- Create: `packages/oxc-config/anti-slop/UPSTREAM-IMAPPS.md` (upstream commit hash + "effect group removed")
- Create: `packages/oxc-config/tsup.config.ts` (only if Task 1 chose built JS)
- Create: `packages/oxc-config/README.md`
- Test: `packages/oxc-config/test/rules.test.ts`
- Modify: `package.json` root only for devDependencies in Task 3.

**Interfaces:**
- Produces: `@imapps/oxc-config/oxlint` default export `OxlintConfig` object with `jsPlugins`, `rules`, `ignorePatterns`, `overrides`; `@imapps/oxc-config/oxfmt` default export oxfmt config object; plugin specifier `@imapps/oxc-config/anti-slop` (resolves to built/raw entry per Task 1).

- [ ] **Step 1: Scaffold + vendor.** `node /tmp/as-src/skills/install-anti-slop/scripts/install.mjs packages/oxc-config/anti-slop`, then `rm -rf packages/oxc-config/anti-slop/effect`. Write `UPSTREAM-IMAPPS.md`.
- [ ] **Step 2: Generate oxfmt options.** In a scratch copy of kivo's `biome.json` run `bunx oxfmt --migrate biome` and compare output to Global Constraints; the committed `src/oxfmt.ts` must contain exactly the constraint values (use `sortImports: {}` per the oxfmt config schema; check `https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html` for exact key names and fix if the migrate output differs).
- [ ] **Step 3: Write failing test** `test/rules.test.ts` (vitest, matches repo convention). It spawns `bunx oxlint` against a temp dir containing a file with one violation per behaviour below and the package's `oxlint` config, asserting each rule id appears in JSON output (`--format json`):

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cases: Record<string, string> = {
    'anti-slop/no-unknown-parameters': 'export function f(x: unknown) { return x; }\n',
    'anti-slop/no-runtime-typeof': "export function g(v: string | number) { return typeof v === 'string'; }\n",
    'anti-slop/no-module-mocking': "import { vi } from 'vitest';\nvi.mock('./x');\n",
    'eqeqeq': 'export const h = (a: number) => a == 1;\n',
};

describe('oxc-config oxlint preset', () => {
    for (const [rule, source] of Object.entries(cases)) {
        it(`reports ${rule}`, () => {
            const dir = mkdtempSync(join(tmpdir(), 'oxc-'));
            writeFileSync(join(dir, 'case.ts'), source);
            writeFileSync(join(dir, 'oxlint.config.ts'),
                `import config from '${join(__dirname, '../src/oxlint.ts')}';\nexport default config;\n`);
            let out = '';
            try { execFileSync('bunx', ['oxlint', '-c', 'oxlint.config.ts', '--format', 'json', 'case.ts'], { cwd: dir, encoding: 'utf8' }); }
            catch (e) { out = (e as { stdout: string }).stdout; }
            expect(out).toContain(rule);
        });
    }
    it('allows any in test files', () => {
        const dir = mkdtempSync(join(tmpdir(), 'oxc-'));
        writeFileSync(join(dir, 'a.test.ts'), 'export const x: any = 1;\n');
        writeFileSync(join(dir, 'oxlint.config.ts'),
            `import config from '${join(__dirname, '../src/oxlint.ts')}';\nexport default config;\n`);
        const out = execFileSync('bunx', ['oxlint', '-c', 'oxlint.config.ts', 'a.test.ts'], { cwd: dir, encoding: 'utf8' });
        expect(out).not.toContain('no-explicit-any');
    });
});
```

- [ ] **Step 4: Run to verify fail.** `cd packages/oxc-config && bunx vitest run` -> FAIL (`src/oxlint.ts` missing).
- [ ] **Step 5: Implement `src/oxlint.ts`:**

```ts
import { defineConfig } from 'oxlint';

const agentDirs = ['.agent', '.agents', '.claude', '.codex', '.continue', '.cursor', '.gemini', '.omp', '.opencode', '.pi', '.roo', '.windsurf'];

export default defineConfig({
    ignorePatterns: [...agentDirs.map((d) => `${d}/**`), '**/.worktrees/**', '**/anti-slop/**'],
    plugins: ['typescript', 'oxc', 'jsx-a11y'],
    jsPlugins: [{ name: 'anti-slop', specifier: '@imapps/oxc-config/anti-slop' }],
    categories: { correctness: 'error' },
    rules: {
        'prefer-const': 'error',
        'prefer-template': 'error',
        eqeqeq: 'warn',
        'typescript/no-explicit-any': 'warn',
        'oxc/no-accumulating-spread': 'error',
        'anti-slop/no-array-filter-map': 'error',
        'anti-slop/no-reduce-accumulator-copy': 'error',
        'anti-slop/no-chained-type-assertions': 'error',
        'anti-slop/no-conditional-empty-object-spread': 'error',
        'anti-slop/no-known-value-widening': 'error',
        'anti-slop/no-module-mocking': 'error',
        'anti-slop/no-object-parameters': 'error',
        'anti-slop/no-reflect-apply': 'error',
        'anti-slop/no-reflect-get': 'error',
        'anti-slop/no-runtime-typeof': 'error',
        'anti-slop/no-shape-in-symbol-names': 'error',
        'anti-slop/no-unknown-parameters': 'error',
        'anti-slop/no-unknown-returns': 'error',
        'anti-slop/no-unknown-type-aliases': 'error',
        'anti-slop/no-unsafe-dictionary-type': 'error',
        'anti-slop/no-widen-then-assert': 'error',
        'anti-slop/require-readable-spacing': 'error',
        'anti-slop/require-safety-comment-for-type-assertion': 'error',
    },
    overrides: [
        { files: ['**/*.test.{ts,tsx,js,jsx}', '**/*.spec.{ts,tsx,js,jsx}'], rules: { 'typescript/no-explicit-any': 'off' } },
    ],
});
```

Note: the `jsPlugins` specifier resolves relative to the config file that is loaded; in the test and in consumers this resolves through node_modules/workspace link. If resolution fails under the spike's finding, use the form Task 1 proved. Write `src/oxfmt.ts` as the values from Step 2.
- [ ] **Step 6: package.json.** name `@imapps/oxc-config`, `exports`: `./oxlint`, `./oxfmt`, `./anti-slop`; `files` includes `anti-slop`, `src` (or `build` if built); `peerDependencies`: exact `oxlint`, `@oxlint/plugins`, `oxfmt`; `publishConfig` copied from biome-config; `"private"` absent. Add `build` script if tsup is needed (follow `packages/api-utils` conventions so `turbo run build` and `scripts/publish-packages.sh`/`stamp-versions.mjs` pick it up; check both scripts for hardcoded package lists and update).
- [ ] **Step 7: Run tests -> PASS.** Then run the upstream plugin's own checks are NOT needed (vendored copy unchanged).
- [ ] **Step 8: Commit** `feat(oxc-config): add shared oxlint/oxfmt config with vendored anti-slop`.

---

### Task 3: Migrate `utils` repo

**Files:**
- Delete: `biome.json`
- Create: `oxlint.config.ts`, `oxfmt.config.ts`
- Modify: `package.json` (deps, scripts, lint-staged), `CLAUDE.md`, `README.md`, `packages/biome-config/package.json` (+`"deprecated"` note in README), `.husky/pre-commit` only if command changes (it runs `bunx lint-staged`; no change expected), `.github/workflows/*` (only if they call biome directly; `grep -rn biome .github` first), `docker/`/`pipelines/` if grep hits.

**Interfaces:** Consumes `@imapps/oxc-config/oxlint` and `/oxfmt` from Task 2 (workspace link).

- [ ] **Step 1: Wire config.**

```ts
// oxlint.config.ts
import base from '@imapps/oxc-config/oxlint';
import { defineConfig } from 'oxlint';
export default defineConfig({ ...base });
```
```ts
// oxfmt.config.ts
import base from '@imapps/oxc-config/oxfmt';
export default base;
```
- [ ] **Step 2: package.json.** Remove `@biomejs/biome`, `@imapps/biome-config`. Add devDeps `"@imapps/oxc-config": "*"`, exact `oxlint`, `@oxlint/plugins`, `oxfmt`. Scripts: `"lint": "oxlint && oxfmt --check"`, `"lint:fix": "oxlint --fix && oxfmt && oxlint"`, `"format": "oxfmt"`. lint-staged: `"*.{ts,tsx,mts,cts,js,jsx}": ["oxlint --fix", "oxfmt"]`, `"*.{json,md,yml,yaml}": "oxfmt"`. `bun install`.
- [ ] **Step 3: Reformat commit.** `bun run format`; `git commit -am "style: reformat with oxfmt"`. Inspect `git diff --stat`; if diff is large for non-import reasons, check `src/oxfmt.ts` options before accepting.
- [ ] **Step 4: Autofix commit.** `bunx oxlint --fix && bunx oxfmt`; commit `refactor: apply oxlint autofixes`.
- [ ] **Step 5: Fix remaining violations by hand** (`bunx oxlint`). Fix per rule semantics (README of anti-slop `skills`/`/tmp/as-src/README.md`): parse at boundaries instead of `typeof`/`unknown`; add `// SAFETY: <invariant>` only where an assertion is truly necessary; replace `vi.mock` with injected seams. Run `bun run test` and `bun run build` after each batch. Commit `refactor: satisfy anti-slop rules`. Do NOT use `oxlint-disable`.
- [ ] **Step 6: Verify.** `bun run lint` exit 0; `bun run test`; `bun run build`; trigger the hook: stage a deliberately bad file and `git commit` -> blocked (then unstage/delete it).
- [ ] **Step 7: Docs.** Update `CLAUDE.md` (Linting line, structure tree: `oxc-config`), `README.md` lines 13/42/46, and add to `CLAUDE.md`: "Run `bun run lint:fix` before finishing; fix anti-slop violations, never suppress them." Mark `@imapps/biome-config` README deprecated. Commit `docs: document oxc toolchain`.
- [ ] **Step 8: Release.** Open PR using `feat(oxc-config): ...` conventional commit so semantic-release publishes. After merge, note the published `@imapps/oxc-config` version for Task 4 (`npm view @imapps/oxc-config version`).

---

### Task 4: Migrate `kivo`

**Files:**
- Delete: `biome.json`
- Create: `oxlint.config.ts`, `oxfmt.config.ts`
- Modify: `package.json`, `CLAUDE.md`, `.husky/pre-commit` (unchanged: `bun lint:fix`), any workflow calling biome (grep), all `src/**` violations, `tests/**` violations.

**Interfaces:** Consumes published `@imapps/oxc-config@<version from Task 3 Step 8>`.

- [ ] **Step 1: Branch** `git switch -c chore/oxc-migration` (use `using-git-worktrees` if kivo has uncommitted work; check `git status` first).
- [ ] **Step 2: Deps/scripts.** Remove `@biomejs/biome`, `@imapps/biome-config`. Add `@imapps/oxc-config` (exact released version), exact `oxlint`, `@oxlint/plugins`, `oxfmt` (versions must equal the oxc-config peer pins). Scripts as in Task 3 Step 2. lint-staged as in Task 3 Step 2. `bun install`.
- [ ] **Step 3: Config files** identical to Task 3 Step 1. Preserve kivo's old ignore `!!**/.github/workflows-utils` as `ignorePatterns: ['**/.github/workflows-utils/**']` in `oxlint.config.ts` and equivalent `ignorePatterns` in `oxfmt.config.ts`.
- [ ] **Step 4: Reformat commit** (`bun run format`), then autofix commit, then manual fix commits, exactly as Task 3 Steps 3-5. Run `bun run typecheck`, `bun test` after each batch. Record violation counts per rule in the PR description (`bunx oxlint --format json | jq`) for visibility.
- [ ] **Step 5: Verify.** `bun run lint`, `bun run typecheck`, `bun test`, `bun run build` all exit 0. Run `bash scripts/e2e.sh` if docker is available (kanban gate); otherwise state it was not run.
- [ ] **Step 6: Docs.** `CLAUDE.md`: replace Biome mentions, add the same agent instruction as Task 3 Step 7. Commit.
- [ ] **Step 7: PR** `chore: migrate from biome to oxlint + oxfmt`; confirm CI jobs `lint` and `test` pass (required check names unchanged).

---

## Self-Review

- Spec coverage: package contract (T2), parity of format/lint (T2 Steps 2/5), wiring (T3/T4), docs + agent instruction (T3 S7, T4 S6), ordering utils->kivo (T3 S8 -> T4), deprecation of biome-config (T3 S7), risk on plugin runtime (T1), reformat isolation (T3 S3, T4 S4).
- Open item resolved inside plan, not guessed: plugin packaging form is decided by Task 1 and Task 2 Step 5 adapts to it.
- Names consistent: `@imapps/oxc-config/{oxlint,oxfmt,anti-slop}`.
