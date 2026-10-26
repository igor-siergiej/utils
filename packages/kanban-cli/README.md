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
future `kanban-cli` upgrades without reinstalling. An installed copy is never
overwritten on its own: after an upgrade, refresh it with
`kanban-cli install-skill --target ~/.claude/skills --force`.

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
| `branch` | string | worker step 6; the factory dispatcher when it starts a run |
| `pr` | number | worker step 9 |
| `merged_commit` | string | worker step 13 |
| `revert_pr` | number | worker step 15 |
| `retries` | object `{implement, e2e_local, ci, deploy, e2e_live}`, numbers | worker retry gates; zeroed on leaving Blocked |
| `blocked_reason` | string | worker / triage when moving to Blocked; removed on leaving Blocked |
| `completed_at` | string, ISO 8601 | worker step 16 |
| `after` | string | a refine run: the **id** of the card this one waits for; the factory builds it only once that card is `done` |
| `refined_from` | string | a refine run: the **id** of the card this one was split out of |
| `refined_at` | string, ISO 8601 | a refine run: when the card was written (the dispatcher's success signal) |

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
  "github": { "defaultBranch": "main", "mergeMethod": "squash" },
  "factory": {
    "rateLimitFallbackMinutes": 30
  }
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

`kanban-cli dispatch` is a long-running loop for foundry. The jott server decides what runs
(`jott factory …`, view 3 of the TUI, the Factory tab on Android): the queue, auto mode, each
card's harness and model, retries, per-provider quota pauses, Stop, and run history all live
there. The dispatcher asks for work, runs it, and reports back. It works one card at a time,
each in its own git worktree (`<repo>/.worktrees/<project>-<n>`, branch `factory/<project>-<n>`;
`.worktrees/` is added to `.git/info/exclude` when not already ignored). Your own checkout is
never touched.

It talks to `$JOTT_URL` with `Authorization: Bearer $JOTT_DISPATCHER_TOKEN` (a device token
with the `dispatcher` role). Both come from the process environment; the service loads them from
`~/.config/kanban-factory.env`. Without them `dispatch` exits 1.

Each cycle is one `POST /v1/dispatcher/claim` (a long poll of up to 25 s):

- **Blocks:** the claim lists cards the server decided are blocked (an `error`, or a second
  failure in a row). The dispatcher moves each to Blocked locally with the server's reason, syncs,
  and sends the phone push. The server never writes tasks; column moves stay local `jott` writes.
- **Run:** the claimed card is set `in-progress` (and `blocked_reason` cleared), its worktree is
  made (and `bun install`ed when new), and the harness the server picked runs the kanban-worker
  skill's single-card mode in it, with the server's model and, for a resumed card, its session. An
  answer to an earlier block (`jott factory reply`) and the old `blocked_reason` go in the prompt.
  The run's outcome goes back with `POST /v1/dispatcher/runs/<id>/end`; the server answers
  `none`, `retry` (card stays in progress, nothing written) or `block` (with a reason).
- **Heartbeat and activity:** from the moment of the claim, every 5 s, the dispatcher sends the
  run's latest activity: the newest assistant text, or a tool name plus its JSON args, never
  thinking or tool results, cut to 200 characters with `Bearer …`, `token=…`-style values and any
  Bitwarden (`bw `, `BW_SESSION`) call args masked. A run the server stops hearing from for 60 s
  is failed there. Harness output is parsed in memory only and never logged or kept on disk.
- **Stop:** when Igor stops a run, the next heartbeat answers `stop: true`; the harness's whole
  process tree is killed (SIGTERM, then SIGKILL after 2 s), the card goes to Blocked with
  `Stopped from jott`, and the session id goes to the server so the card can resume it.
- **Card id guard:** every local write first checks that the local `#N` has the server's card
  id; card numbers can change on a sync collision, and a mismatch is skipped and logged.

A worker is a headless harness run. The model id is the harness's own syntax: omp takes
`provider/model` (`minimax-code/MiniMax-M3`), Claude Code takes a bare model id. Two adapters
exist:

- `claude` runs as `claude -p --dangerously-skip-permissions --output-format stream-json`,
  so it has your full user rights on the host.
- `omp` runs as `omp -p <prompt> --mode json --auto-approve`, with an overlay that turns
  omp's `ask` tool off — an unattended worker has to decide, not wait for a human. It
  resumes a session with `omp --resume <session-id>`.

Both report `done` (with the session id), `rate_limited` (with the time the provider says the
limit lifts), `failed`, or `stopped`. After `done` the dispatcher reads the card: `done` removes
the worktree, `blocked` reports the worker's `blocked_reason`, and anything else counts as a
failure ("The worker finished without moving the card to done or blocked.").

- **Rate limit:** a `rate_limit_event` with `status: rejected` (claude), an `api_error_status`
  of 429, or an HTTP 429 / `rate_limit_error` / `usage_limit_reached` / `insufficient_quota`
  error (omp) ends the run `rate_limited` with the reset time; the card stays `in-progress` and
  the server pauses that provider and resumes the session after the reset. A provider that says
  "limited" without saying when uses `factory.rateLimitFallbackMinutes` (default 30).
- **Server down:** claims back off (10 s doubling to 60 s, `{ok:false,error}` on stderr). A run
  in flight keeps running, and its `end` is retried until the server answers.
- **Log:** one JSON line per run (`run, card, agent, model, start, end, outcome, exitCode`) in
  `~/.local/state/kanban-cli/factory.log` (`KANBAN_FACTORY_LOG`).
- **Phone push:** when a card ends `blocked` or `done`, it POSTs to ntfy at `NTFY_URL`
  (default `http://100.79.92.93:8090/jott-factory`, tailnet only). Title `<project> #<n> blocked|done`,
  body the card title plus the first line of `blocked_reason`. Stops and pauses send nothing, and a
  failed post is logged to stderr, never failing the run.
- `--once` runs a single claim and prints `{ok:true, result:{ran?, outcome?, blocked:[…]}}`.

### Refine runs

A claimed run can also be a **refine**: the server sends `kind: "refine"` with the
claim (a server that sends no kind only ever runs builds). The dispatcher then runs
the `refining-kanban-captures` skill in its factory mode instead of the worker. A
refine builds nothing: it reads the repo and writes the card back — one rewritten
Backlog card, or a chain of them, each waiting on the previous one through
`meta.after`.

- The card keeps its column (`inbox` or `backlog`): a refine never writes a status.
  Only `blocked_reason` and `refined_at` are cleared before the run.
- A card with a project gets a worktree like a build, but no `meta.branch`. A card
  without one runs in the first `KANBAN_CLI_REPO_ROOTS` entry, where the skill can
  route it to a project.
- The run succeeded when the card carries `meta.refined_at`: the worktree is removed
  and the phone is notified. A blocked card ends the run `blocked` with its reason
  (the answer comes back in the next run), and anything else fails with "The refine
  run finished without writing the card."

Install as a user service with [`docs/factory.service`](docs/factory.service), after minting a
dispatcher token on the server (`bun run cli device add <name> --role dispatcher`):

```sh
printf 'JOTT_URL=%s\nJOTT_DISPATCHER_TOKEN=%s\n' "$url" "$token" >> ~/.config/kanban-factory.env
chmod 600 ~/.config/kanban-factory.env
cp docs/factory.service ~/.config/systemd/user/kanban-factory.service
systemctl --user daemon-reload && systemctl --user enable --now kanban-factory
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
kanban-cli install-skill --target <dir> [--skill <name>] [--symlink] [--force]

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
overwrites a skill that is already present — it reports those as `skipped`. `--force`
overwrites them instead, which is how an installed copy picks up a newer packaged
skill (the factory dispatcher runs the installed copy, not the one in the repo).

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
