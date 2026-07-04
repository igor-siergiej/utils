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

`##` headings are columns — `Backlog`, `In Progress`, `Blocked`, `Done` are required,
extra columns are allowed. `###` headings are items, each followed by a fenced yaml
metadata block, then freeform Markdown body (description/acceptance criteria) up to a
`---` line or the next heading.

```markdown
# Kanban Board

## Backlog

### Add dark mode toggle to settings page

​```yaml
id: shoppingo-042
repo: /home/igor/dev/shoppingo
tags: [ui, frontend]
retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 }
​```

Add a dark/light theme toggle to Settings, persisted in localStorage.

**Acceptance criteria**
- Toggle appears in Settings > Appearance
- Theme persists across reloads
- New e2e spec covers switching the toggle and reloading

---

## In Progress
## Blocked
## Done
```

Required item fields: `id` (unique across the file), `repo` (an **already-cloned
local path** — kanban-cli never clones for you). `retries` defaults to all-zero if
omitted. Optional: `tags`, `branch`, `pr`, `merged_commit`, `revert_pr`,
`blocked_reason`, `completed_at`. Always edit this file through `kanban-cli
next/show/move/update` rather than by hand, so the parser/serializer round-trip and
retry counters stay intact.

## Per-repo config — `.kanban-cli.json`

Lives at the root of each repo referenced by a board item's `repo` field:

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
```

## Known limitations

- `repo`-cloning is not supported by design — items must point at an already-cloned
  local checkout.
- The `gh`-shelling and process-spawning commands (`pr *`, `ci wait`, `deploy wait`,
  `e2e local`/`e2e live`) are integration surfaces, not unit-tested — see
  `src/**/*.test.ts` for what is covered (the pure kanban parsing/serialization,
  repo-config validation, and polling/backoff logic). Verify those against a real
  repo with `gh` authenticated before relying on them.
