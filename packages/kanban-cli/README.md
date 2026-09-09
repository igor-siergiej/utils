# @imapps/kanban-cli

CLI + Claude Code skill that drives a Kanban-board markdown file to completion,
one Backlog item at a time, across any of your local repo checkouts: implement the
change, run Playwright e2e locally as a merge gate, open a PR, wait for CI, merge
autonomously, wait for the post-merge deploy, run a live Playwright smoke check
against staging/prod, and revert + block if that fails.

Deterministic steps (parsing/moving board items, polling `gh` for CI/deploy status,
starting the app and running e2e, merging/reverting PRs) are plain TypeScript run via
Bun — see `skill/SKILL.md` for the full orchestration the `kanban-worker` skill
follows, tagging which steps are CLI calls vs. steps that need an agent's judgment.

## Installing the skill

```sh
bun add -g @imapps/kanban-cli
kanban-cli install-skill --target ~/.claude/skills          # usable from any repo
kanban-cli install-skill --target <repo>/.claude/skills     # scoped to one repo
```

Pass `--symlink` instead of the default copy if you want the installed skill to track
future `kanban-cli` upgrades without reinstalling.

## The board file

A YAML frontmatter block with a required `project` key, then `##` column
headings (`Backlog`, `In Progress`, `Blocked`, `Done` required; extra columns
allowed), then `###` item headings. Each item is followed by a Markdown bullet
list of its fields, then a freeform Markdown body (description / acceptance
criteria) up to a `---` line or the next heading.

```markdown
---
project: shoppingo
---

# Shoppingo Kanban Worker Board

## Backlog

### Add dark mode toggle to settings page

- **id:** shoppingo-dark-mode
- **tags:** ui, frontend
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Add a dark/light theme toggle to Settings, persisted in localStorage.

**Acceptance criteria**
- Toggle appears in Settings > Appearance
- Theme persists across reloads

---

## In Progress
## Blocked
## Done
```

The board file is designed to be hand-editable — including from a phone (e.g.
Obsidian over a synced folder). `- **id:**` and `- **retries:**` are always
written; `- **tags:**`, `- **branch:**`, `- **pr:**`, `- **merged_commit:**`,
`- **revert_pr:**`, `- **blocked_reason:**`, `- **completed_at:**` appear only
when set. `retries` counters default to zero when a gate is omitted.

`id` must be unique across the file. There is **no `repo` field** — the board
carries only `project`, and each machine resolves its own checkout path (see
below). Prefer editing through `kanban-cli next/show/move/update` so the
round-trip and retry counters stay intact, but a careful hand-edit of the
bullet list or body is fine.

### Resolving the checkout path

`kanban-cli` turns the board's `project` into a local repo path by scanning for
`.kanban-cli.json` files: for each directory listed in `KANBAN_CLI_REPO_ROOTS`
(colon-separated; defaults to your home directory), it looks one level deep for
a `*/.kanban-cli.json` whose `repoName` equals `project`. Set
`KANBAN_CLI_REPO_ROOTS=/path/to/your/checkouts` if your repos do not live
directly under `$HOME`.

### Migrating an existing board

Older boards stored each item's fields in a fenced ` ```yaml ` block and a
per-item `repo` path. `kanban-cli` still reads that format. To convert a board
in place:

```sh
kanban-cli migrate path/to/board.md --project <name>
```

(`--project` is only needed when the file has no `project` frontmatter yet.)

## Per-repo config — `.kanban-cli.json`

Lives at the root of each repo a board resolves to via its `project` key. Its
`repoName` is what `project` is matched against during checkout-path resolution:

```jsonc
{
  "repoName": "shoppingo",
  "dev": {
    "startCommand": "docker compose -f docker-compose.dev.yml up -d",
    "healthCheckUrl": "http://localhost:3000/health",
    "healthCheckTimeoutMs": 60000,
    "healthCheckIntervalMs": 2000,
    "teardownCommand": "docker compose -f docker-compose.dev.yml down"
  },
  "e2e": {
    "testCommand": "bun run test:e2e",
    "smokeGrep": "@smoke",
    "configPath": "playwright.config.ts"
  },
  "ci": {
    "workflowNames": ["CI/CD"],
    "checkNamesRequired": ["lint", "test"]
  },
  "deploy": {
    "workflowName": "Deploy",
    "timeoutMs": 900000,
    "pollIntervalMs": 15000
  },
  "environments": {
    "staging": { "baseUrl": "https://staging.shoppingo.example.com" }
  },
  "targetEnvironment": "staging",
  "retryPolicy": { "implement": 3, "e2e_local": 3, "ci": 3, "deploy": 2, "e2e_live": 1 },
  "github": { "defaultBranch": "main", "mergeMethod": "squash" }
}
```

Only `repoName`, `dev.startCommand`, `dev.healthCheckUrl`, `e2e.testCommand`,
`e2e.smokeGrep`, `ci.workflowNames`, `deploy.workflowName`, `environments`, and
`targetEnvironment` are required — everything else has a default (see
`src/repoConfig/types.ts`). `e2e.smokeGrep` is the one convention used both to scope
the post-deploy live check (always applied there — a live check never runs the full
suite against production) and optionally the local gate.

If a repo has no `.kanban-cli.json` yet, `kanban-cli repo-check <repoPath>` reports
`configFound: false` rather than erroring — the `kanban-worker` skill treats that as a
one-time setup step to walk you through before continuing.

## Pausing on the 5-hour usage limit

The `kanban-worker` skill can run for hours across many board items in one
Claude Code session. To avoid running until the Claude subscription's rolling
5-hour usage window hard-blocks mid-work, wire your Claude Code `statusLine`
hook to also feed `kanban-cli record-usage`:

```sh
# inside your statusLine script, alongside its existing rendering logic
if command -v kanban-cli >/dev/null 2>&1; then
    printf '%s' "$input" | kanban-cli record-usage >/dev/null 2>&1 &
fi
```

(`$input` is the JSON the statusLine hook already receives on stdin — the
same payload `rate_limits.five_hour.used_percentage` comes from, if your
statusline already renders a usage bar.) This persists the window's
utilization and reset time to `~/.claude/kanban-cli/usage-state.json`
(override with `KANBAN_CLI_USAGE_STATE_PATH`) every time the statusline
renders — effectively continuously, for as long as a pty stays attached to
the session.

Without this wired up, `kanban-cli usage-check` always reports `unknown` and
the `kanban-worker` skill just keeps working — the pause/resume behavior is
opt-in, not required to use the rest of the CLI.

## Requirements

`gh` (GitHub CLI) must be installed and authenticated wherever `kanban-cli`'s PR/CI/
deploy commands run — `kanban-cli` shells out to it rather than reimplementing the
GitHub API. `git` must be available for the revert flow.

## CLI reference

Every command prints one JSON object to stdout on success (`{"ok":false,"error":...}`
to stderr with a non-zero exit code on a CLI-level failure — bad args, missing file,
`gh` not found). A domain-level outcome (tests failed, CI failed, health check timed
out) is `ok:true` with a `result`/`status` field, not a CLI-level failure.

```
kanban-cli next [--kanban <path>]
kanban-cli show <id> [--kanban <path>]
kanban-cli move <id> <column> [--note <text>] [--kanban <path>]
kanban-cli update <id> [--set-branch <name>] [--set-pr <n>] [--set-merged-commit <sha>]
                       [--set-revert-pr <n>] [--inc-retry <gate>] [--complete] [--kanban <path>]
kanban-cli columns [--kanban <path>]
kanban-cli migrate <board> [--project <name>]

kanban-cli repo-check <repoPath>
kanban-cli install-skill --target <dir> [--symlink]

kanban-cli e2e local <repoPath> [--grep <pattern>]
kanban-cli e2e live <repoPath> --url <baseUrl> [--grep <pattern>]
kanban-cli e2e bootstrap <repoPath> [--force]

kanban-cli pr create <repoPath> --title <t> --body <b> --base <branch> --head <branch>
kanban-cli pr status <repoPath> <prNumber>
kanban-cli pr merge <repoPath> <prNumber> [--method squash|merge|rebase]
kanban-cli pr revert <repoPath> --commit <sha> --base <branch> --title <t> --summary <s> [--pr-number <n>]

kanban-cli ci wait <repoPath> <prNumber> [--timeout <ms>] [--interval <ms>] [--required <name>]
kanban-cli deploy wait <repoPath> --workflow <name> --commit <sha> [--timeout <ms>] [--interval <ms>]

kanban-cli record-usage                 # reads statusline JSON from stdin, persists the 5hr usage window
kanban-cli usage-check [--threshold <pct>] [--max-staleness-ms <ms>]
```

## Known limitations

- Cloning is not supported by design — a board's `project` must resolve to an
  already-cloned local checkout.
- The `gh`-shelling and process-spawning commands (`pr *`, `ci wait`, `deploy wait`,
  `e2e local`/`e2e live`) are integration surfaces, not unit-tested — see
  `src/**/*.test.ts` for what is covered (the pure kanban parsing/serialization,
  repo-config validation, and polling/backoff logic). Verify those against a real
  repo with `gh` authenticated before relying on them.
