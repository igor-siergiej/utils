# @imapps/dev-scripts

Shared dev/CI scripts for IM Apps projects.

## fallow-audit

Runs the [fallow](https://fallow.tools) dead-code/complexity audit the same way CI
does, so findings surface locally before pushing. The fallow binary is downloaded
on first use into `.tooling/` (gitignore it).

### Usage

Install as a dev dependency:

```sh
bun add -D @imapps/dev-scripts
```

Add a script and a pre-push hook:

```jsonc
// package.json
{
  "scripts": {
    "audit": "fallow-audit"
  }
}
```

```sh
# .husky/pre-push
bun run audit
```

```gitignore
# .gitignore
.tooling/
```

### Environment

| Var | Default | Description |
| --- | --- | --- |
| `FALLOW_GATE` | `new-only` | `new-only` flags only findings in changed files; `all` enforces the whole repo. |
| `FALLOW_VERSION` | `latest` | fallow release tag to download (e.g. `v2.91.0`). |

The local hook intentionally defaults to `new-only` so it only blocks on findings
you introduce; CI enforces the project's full gate.
