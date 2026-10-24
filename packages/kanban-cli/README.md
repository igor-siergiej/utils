# @imapps/kanban-cli

CLI + Claude Code skill that works jott tasks to completion, one Todo task at a
time, across any of your local repo checkouts: implement the change, run Playwright
e2e locally as a merge gate, open a PR, wait for CI, merge autonomously, wait for the
post-merge deploy, run a live Playwright smoke check against staging/prod, and
revert + block if that fails.

Deterministic repo steps (polling `gh` for CI/deploy status, starting the app and
running e2e, merging/reverting PRs) are plain TypeScript run via Bun — see
`skill/SKILL.md` for the full orchestration the `kanban-worker` skill follows,
tagging which steps are CLI calls vs. steps that need an agent's judgment.

## Installing the skill

```sh
bun add -g @imapps/kanban-cli
kanban-cli install-skill --target ~/.claude/skills          # usable from any repo
kanban-cli install-skill --target <repo>/.claude/skills     # scoped to one repo
```

Pass `--symlink` instead of the default copy if you want the installed skill to track
future `kanban-cli` upgrades without reinstalling.

## Tasks live in jott

`kanban-cli` keeps no task state. Tasks (status, title, tags, body, project) live
in jott, and the skills read and write them with `jott task … --json`. A task's
`project` is what `kanban-cli` turns into a local checkout:

```sh
kanban-cli resolve-repo <project>                       # → {"ok":true,"repo":"/path/to/checkout"}
kanban-cli clone <project> [--url <repoUrl>] [--root <dir>]
```

`resolve-repo` scans for `.kanban-cli.json` files: for each directory listed in
`KANBAN_CLI_REPO_ROOTS` (colon-separated; defaults to your home directory), it looks
up to two levels deep (`<root>/*/.kanban-cli.json` and
`<root>/*/*/.kanban-cli.json`) for one whose `repoName` equals `project`. Set
`KANBAN_CLI_REPO_ROOTS=/path/to/your/checkouts` if your checkouts are deeper than
that or live elsewhere. More than one match is an error.

`clone` is a no-op (`cloned: false`) once the project resolves. Otherwise it clones
`--url` (any URL `git clone` accepts; the skill passes the task's `meta.repo_url`) to
`<root>/<project>` (default root: the first `KANBAN_CLI_REPO_ROOTS` entry) and writes
a minimal `{"repoName": "<project>"}` `.kanban-cli.json` if the repo doesn't ship
one. It never clones over an existing directory.

Agent-worked tasks carry these `meta` keys. Every key is optional; absent means
unset.

| Key | JSON type | Written by |
|---|---|---|
| `slug` | string | migration only (old card id) |
| `repo_url` | string | migration (board `repoUrl` frontmatter); humans for new projects |
| `branch` | string | worker step 6 |
| `pr` | number | worker step 9 |
| `merged_commit` | string | worker step 13 |
| `revert_pr` | number | worker step 15 |
| `retries` | object `{implement, e2e_local, ci, deploy, e2e_live}`, numbers | worker retry gates; zeroed on leaving Blocked |
| `blocked_reason` | string | worker / triage when moving to Blocked; removed on leaving Blocked |
| `completed_at` | string, ISO 8601 | worker step 16 |

## Per-repo config — `.kanban-cli.json`

Lives at the root of each repo a task's `project` resolves to. Its `repoName` is what
`project` is matched against during checkout-path resolution:

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

`e2e local` and `e2e live` both run their test command with `CI` **removed** from the
environment, whatever the parent had. These runs are local by definition, and the
conventional `reuseExistingServer: !process.env.CI` in a Playwright config otherwise
makes Playwright start a second dev server on the port `e2e local` already started and
health-checked (or boot a whole local stack for an `e2e live` run aimed at a deployed
URL). Agent harnesses, task runners and some terminals export `CI=true`, so this is not
hypothetical.

With no `dev.teardownCommand`, `e2e local` tears the app down by killing the started
shell's entire process tree, not just the shell: a `bash -lc "bun run dev"` root sits
two or three forks above the process that actually binds the port, and orphaning those
leaves the port bound for the next run.

If a repo has no `.kanban-cli.json` yet, `kanban-cli repo-check <repoPath>` reports
`configFound: false` rather than erroring — the `kanban-worker` skill treats that as a
one-time setup step to walk you through before continuing.

`kanban-cli init-config <repoPath>` writes that file for you, filling every field it can
infer: `repoName` from `package.json`, `dev.startCommand` and `e2e.testCommand` from its
scripts and the detected package manager, `e2e.configPath` from an existing Playwright
config, `ci.workflowNames` from the workflows under `.github/workflows` that run on
`pull_request`, and `deploy.workflowName` from a workflow named like `deploy` or `CD`.
`environments` comes from `--base-url` (or an `http(s)` `homepage` in `package.json`).
Values already in an existing file always win, so it is safe to re-run on a partial
config. Fields it cannot infer are left out — never filled with placeholders — and
listed in the result's `missing` array:

```json
{"ok":true,"path":"…/.kanban-cli.json","written":true,"inferred":["repoName","dev","e2e","ci"],
 "missing":["deploy.workflowName","environments","targetEnvironment"],"valid":false,
 "validationError":"'targetEnvironment' is required and must be a non-empty string"}
```

## Pausing on the 5-hour usage limit

The `kanban-worker` skill can run for hours across many tasks in one
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
opt-in, not required to use the rest of the CLI. `unknown` carries a `reason`:
`no-state` (nothing has ever been recorded) or `stale` (telemetry stopped
arriving). The first `no-state` result also carries a `hint` explaining the wiring
above; a `<state file>.hint-shown` marker keeps it from repeating.

## Factory: unattended runs (`kanban-cli dispatch`)

`kanban-cli dispatch` is a long-running loop for foundry. It works jott cards one at a time,
each in its own git worktree (`<repo>/.worktrees/<project>-<n>`, branch `factory/<project>-<n>`;
`.worktrees/` is added to `.git/info/exclude` when not already ignored). Your own checkout is
never touched. Every tick it syncs jott and picks, in order:

1. an `in-progress` card whose `meta.paused_until` has passed (a run that hit the rate limit);
2. a `todo` card with `meta.go = true`;
3. any other `todo` card in board order, only when the note `factory/settings` says `auto: on`.

Inbox, Backlog and Blocked cards never run. A worker is a headless harness run in the
worktree, using the kanban-worker skill's single-card mode. The harness comes from
`meta.agent`, else `factory.defaultAgent` in `.kanban-cli.json`, else `claude`. Two
adapters exist:

- `claude` runs as `claude -p --dangerously-skip-permissions --output-format stream-json`,
  so it has your full user rights on the host.
- `omp` runs as `omp -p <prompt> --mode json --auto-approve`, with an overlay that turns
  omp's `ask` tool off — an unattended worker has to decide, not wait for a human. It
  resumes a paused run with `omp --resume <session-id>`.

Both report the same three outcomes: `done` (with the session id), `rate_limited` (with
the time the provider says the limit lifts) and `failed`. A provider that reports a quota
wall but no reset time pauses the card for 30 minutes.

- **Rate limit:** a `rate_limit_event` with `status: rejected` pauses the card. It stays
  `in-progress` with `meta.paused_until` and `meta.session_id`. No new card starts until the
  reset, and then the run resumes the same session.
- **Failure:** a crash, an error result, or a run that leaves the card `in-progress` is retried
  once. The second failure blocks the card with the summary. A card the dispatcher was running
  when it died counts as one failure on the next start.
- **Reply:** a blocked card moved back to `todo` with `meta.reply` gets the reply (and the old
  `blocked_reason`) in its prompt. Both are cleared when the run starts, along with `go`.
- **Status:** the note `factory/status` holds `state: idle|running <project>#<n>|paused`,
  `paused_until`, and `updated`.
- **Log:** one JSON line per run (`card, agent, start, end, outcome, exitCode`) in
  `~/.local/state/kanban-cli/factory.log` (`KANBAN_FACTORY_LOG`). Harness output is never logged.
- **Phone push:** when a card ends `blocked` or `done`, it POSTs to ntfy at `NTFY_URL`
  (default `http://100.79.92.93:8090/jott-factory`, tailnet only). Title `<project> #<n> blocked|done`,
  body the card title plus the first line of `blocked_reason`. Pauses send nothing, and a failed
  post is logged to stderr, never failing the run.
- `--once` runs a single tick and prints its result.

Install as a user service with [`docs/factory.service`](docs/factory.service):

```sh
cp docs/factory.service ~/.config/systemd/user/kanban-factory.service
systemctl --user daemon-reload && systemctl --user enable --now kanban-factory
jott add --path factory/settings "auto: off"
```

`kanban-cli worktree create|remove <project> <n>` manages a card's worktree by hand.

## Refining from the phone

The `refining-kanban-captures` skill has an interactive one-card mode: say
`refine <project> #<n>` and it investigates the repo, asks one question at a
time, plays back what it understood, then writes a grounded body (with a
`## Decisions` list) and moves the card to Backlog. Nothing is written if the
chat ends early.

To reach it from the Claude mobile app, keep Remote Control running on foundry as a user
service with [`docs/remote-control.service`](docs/remote-control.service) (new sessions start in
`~/imapps`), connect from the app, and start a fresh session per card (a long-lived session
loses the prompt cache and costs more). Remote Control asks for consent once, so run
`claude remote-control` by hand first and answer `y`:

```sh
cp docs/remote-control.service ~/.config/systemd/user/claude-remote-control.service
systemctl --user daemon-reload && systemctl --user enable --now claude-remote-control
```

## Requirements

`gh` (GitHub CLI) must be installed and authenticated wherever `kanban-cli`'s PR/CI/
deploy commands run — `kanban-cli` shells out to it rather than reimplementing the
GitHub API. Only long-standing flags are used (`gh pr view/create/merge --json`,
`gh run list --json`), so older `gh` builds work: notably `ci wait` reads
`gh pr view --json statusCheckRollup` rather than `gh pr checks --json`, which only
exists in `gh` >= 2.48. `git` must be available for the revert flow.

## CLI reference

Every command prints one JSON object to stdout on success (`{"ok":false,"error":...}`
to stderr with a non-zero exit code on a CLI-level failure — bad args, missing file,
`gh` not found). A domain-level outcome (tests failed, CI failed, health check timed
out) is `ok:true` with a `result`/`status` field, not a CLI-level failure.

```
kanban-cli resolve-repo <project>
kanban-cli clone <project> [--url <repoUrl>] [--root <dir>]

kanban-cli repo-check <repoPath>
kanban-cli init-config <repoPath> [--repo-name <n>] [--base-url <url>] [--environment <name>]
kanban-cli install-skill --target <dir> [--skill <name>] [--symlink]

kanban-cli e2e local <repoPath> [--grep <pattern>]
kanban-cli e2e live <repoPath> --url <baseUrl> [--grep <pattern>]
kanban-cli e2e bootstrap <repoPath> [--force]

kanban-cli pr create <repoPath> --title <t> --body <b> --base <branch> --head <branch>
kanban-cli pr status <repoPath> <prNumber>
kanban-cli pr merge <repoPath> <prNumber> [--method squash|merge|rebase]
kanban-cli pr revert <repoPath> --commit <sha> --base <branch> --title <t> --summary <s> [--pr-number <n>]

kanban-cli ci wait <repoPath> <prNumber> [--timeout <ms>] [--interval <ms>] [--required <name>]
kanban-cli deploy wait <repoPath> --workflow <name> --commit <sha> [--timeout <ms>] [--interval <ms>]
kanban-cli ship <repoPath> [--title <t> --body <b>] [--head <branch>] [--ci-timeout <ms>]

kanban-cli record-usage                 # reads statusline JSON from stdin, persists the 5hr usage window
kanban-cli usage-check [--threshold <pct>] [--max-staleness-ms <ms>]
```

`ship` runs the tail of the worker loop for ad-hoc work on a feature branch: refuse
a dirty tree or the base branch, push, reuse the branch's open PR (or create one,
which needs `--title` and `--body`), `ci wait` on `ci.checkNamesRequired`, merge
with `github.mergeMethod`, `deploy wait`, then live smoke against
`targetEnvironment`. A smoke failure auto-reverts (revert PR, CI, merge, deploy,
smoke again) and reports `revert.restored`. CI and deploy failures stop and report
without reverting. `result.stage` is `ci`, `deploy`, `e2e_live` or `done`.

`install-skill` installs every packaged skill (`kanban-worker`,
`refining-kanban-captures` and `triaging-blocked-cards`) unless `--skill <name>` narrows it, and never
overwrites a skill that is already present — it reports those as `skipped`.

`ci wait --required <name>` (repeatable) narrows the gate to those checks — and waits
for each of them to *appear*: a required job GitHub has not reported yet counts as
pending, so a job queued a few seconds after its siblings can't let the gate pass
before it has run. A failure in a required check is still terminal immediately.

## Known limitations

- Cloning only happens on request: a task's `project` must resolve to a local
  checkout, and `kanban-cli clone` creates one only when given `--url` (the
  skill passes the task's `meta.repo_url`).
- The `gh`-shelling commands (`pr *`, `ci wait`, `deploy wait`) are unit-tested
  against a scripted fake of the process layer (`src/testing/fakeProcess.ts`), which
  pins the argv they send and how they read `gh`'s output, but not real `gh`/GitHub
  behaviour. Verify those paths against a real repo with `gh` authenticated before
  relying on them.
