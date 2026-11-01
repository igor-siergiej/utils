# @imapps/oxc-config

Shared [Oxlint](https://oxc.rs/docs/guide/usage/linter) and [Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
configuration for IM Apps projects, including the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) lint rules.

JS plugins in Oxlint are alpha and not semver-stable, so `oxlint`, `@oxlint/plugins` and `oxfmt` are exact-pinned peer dependencies.
Install the same versions in the consuming repo.

## Usage

```bash
bun add -d @imapps/oxc-config oxlint@1.90.0 @oxlint/plugins@1.90.0 oxfmt@0.75.0
```

`oxlint.config.ts`:

```ts
import { defineConfig } from 'oxlint';
import oxlintConfig from '@imapps/oxc-config/oxlint';

export default defineConfig({ ...oxlintConfig });
```

`oxfmt.config.ts`:

```ts
import oxfmtConfig from '@imapps/oxc-config/oxfmt';

export default oxfmtConfig;
```

Scripts:

```json
{
  "lint": "oxlint && oxfmt --check",
  "lint:fix": "oxlint --fix && oxfmt && oxlint",
  "format": "oxfmt"
}
```

## What is included

- Lint: `correctness` category, `typescript`/`oxc`/`jsx-a11y` plugins, `prefer-const`, `prefer-template`,
  `eqeqeq` (warn), `typescript/no-explicit-any` (warn, off in `*.test.*`/`*.spec.*`), `oxc/no-accumulating-spread`,
  and the 18 generic anti-slop rules at `error`. Agent directories (`.claude`, `.omp`, `.pi`, ...), `.worktrees` and the vendored plugin are ignored.
- Format: 4-space indent, width 120, single quotes, semicolons, `es5` trailing commas, `always` arrow parens,
  2-space JSON, `sortImports` on.

## Layout

- `src/oxlint.ts`, `src/oxfmt.ts`: the config objects.
- `anti-slop/`: vendored plugin source (see `anti-slop/UPSTREAM-IMAPPS.md`).
- Everything is built with `tsup` into `build/`; the package exports only built JS because Node cannot load `.ts` from `node_modules`.

## Development

```bash
bun run build
bun run test   # builds, then lints fixtures with the built config
```
