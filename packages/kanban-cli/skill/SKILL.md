---
name: kanban-worker
description: Autonomously works a Kanban-board markdown file across local repo checkouts — implements the item, runs Playwright e2e locally as a merge gate, opens a PR, reviews it, waits for CI, merges, waits for deploy, runs a live smoke check, and reverts+blocks if that fails. Use when the user says "work the kanban board", "pick up the next backlog item", "run the kanban worker", or similar.
---

# Kanban worker

Drives a Kanban-board markdown file to completion, one Backlog item at a time,
across any of the user's local repo checkouts. Deterministic steps are delegated to
the `kanban-cli` CLI (shipped alongside this skill in `@imapps/kanban-cli`); anything
requiring judgment — implementing code, debugging failures, writing e2e assertions,
reviewing the diff, deciding when something is genuinely blocked — is done directly
by you, the agent running this skill.

## Locating the CLI

Check, in order: `command -v kanban-cli`, then `bunx --bun @imapps/kanban-cli --help`.
If neither works, tell the user it needs installing (`bun add -g @imapps/kanban-cli`
or as a devDependency of the repo hosting the board) before continuing. All examples
below assume the binary is on PATH as `kanban-cli`; substitute the bunx form if not.

Every `kanban-cli` command prints one JSON object to stdout on success, or
`{"ok":false,"error":"..."}` to stderr with a non-zero exit code on a CLI-level
failure (bad args, missing file, `gh` not installed/authenticated). A **domain-level**
outcome — e2e tests failed, CI failed, a health check timed out — is NOT a CLI-level
failure: those come back as `ok:true` with a `result`/`status` field describing what
happened. Always branch on that field, not on exit code, to decide whether to retry,
debug, or block.

## Locating the board file

The user points you at a path to a Kanban markdown file (see schema below). Pass it
explicitly with `--kanban <path>` on every kanban-cli invocation, or export
`KANBAN_CLI_BOARD=<path>` once per session so you can omit the flag.

## Board schema (for reference — see also `.kanban-cli.json` per repo)

`##` headings are columns (`Backlog`, `In Progress`, `Blocked`, `Done` are required;
extra columns are fine). `###` headings are items, each immediately followed by a
fenced ` ```yaml ` block of structured fields (`id`, `repo`, `retries`, and optional
`tags`/`branch`/`pr`/`merged_commit`/`revert_pr`/`blocked_reason`/`completed_at`),
then freeform Markdown body (description/acceptance criteria) up to a `---` line or
the next heading. **Never hand-edit this file directly** — always go through
`kanban-cli next/show/move/update`, so the parser/serializer round-trip stays intact
and retry counters aren't lost. Full example lives in the package README.

## Per-item loop

Repeat from step 1 until `kanban-cli next` returns `item: null`, then stop and report
a summary of what was completed/blocked this session.

**[CLI]** = shell out to kanban-cli (deterministic, no judgment). **[Claude]** = your
own reasoning/tool use.

1. **[CLI]** `kanban-cli next --kanban <board>`. If `item` is `null`, the board has no
   more actionable work — stop here.
2. **[CLI]** `kanban-cli repo-check <item.repo>`.
   - If `configFound: false`: **[Claude]** help the user author `.kanban-cli.json` at
     that repo's root (ask for the dev start/teardown commands, health-check URL, e2e
     test command, CI workflow name(s), deploy workflow name, and staging/prod base
     URL — see the schema in the README). This is one-time per repo, not per item;
     re-run `repo-check` after to confirm it validates, then continue.
   - If `playwrightConfigured: false`: **[CLI]** `kanban-cli e2e bootstrap <item.repo>`,
     then **[Claude]** review the scaffolded config/spec and adjust it to fit the app
     before relying on it.
3. **[CLI]** `kanban-cli move <item.id> "In Progress" --kanban <board>`.
4. **[Claude]** Read `item.title`/`item.body` (acceptance criteria live there).
   Explore `<item.repo>`'s codebase with your own tools, cd'd into that repo, and
   implement the change directly in that checkout.
5. **[Claude]** Create a branch in `<item.repo>` and write/update Playwright spec(s)
   covering the acceptance criteria. Tag any that are cheap and safe enough to also
   run post-deploy against production with `@smoke`.
6. **[CLI]** `kanban-cli update <item.id> --set-branch <branch> --kanban <board>`.
7. **[CLI]** `kanban-cli e2e local <item.repo> [--grep <new-spec-pattern>]` — starts
   the app per `.kanban-cli.json`'s `dev` config, health-checks it, runs the e2e
   command, always tears down.
   - `result.passed: false`: **[Claude]** read `result.failedTests`, debug and fix
     (either the app code or the spec itself). **[CLI]**
     `kanban-cli update <item.id> --inc-retry e2e_local`. If the new retry count is
     `>=` the repo's `retryPolicy.e2e_local` (default 3, from `repo-check`'s
     `config.retryPolicy`), **[CLI]**
     `kanban-cli move <item.id> Blocked --note "<specific last-failure summary>"` and
     stop working this item (go back to step 1 for the next one). Otherwise, loop
     back to step 7.
   - `result.passed: true`: continue.
8. **[Claude]** Commit (conventional commit message) and push the branch.
9. **[CLI]** `kanban-cli pr create <item.repo> --title <t> --body <b> --base main --head <branch>`.
   **[CLI]** `kanban-cli update <item.id> --set-pr <number> --kanban <board>`.
10. **[Claude]** Review your own diff for correctness, style, and risk (equivalent to
    `/code-review`, applied to the PR you just opened). Fix anything you find, push
    again, and re-run step 7 if the fix touched application code (not just docs/PR
    description). This is ordinary iterative development, not a bounded retry gate.
11. **[CLI]** `kanban-cli ci wait <item.repo> <prNumber> [--timeout <ms>]`.
    - `result.status: "failure"`: **[Claude]** pull the failing job's logs (`gh run
      view --log-failed` or the GitHub MCP tools available in this session), debug,
      fix, push. **[CLI]** `kanban-cli update <item.id> --inc-retry ci`. Below the
      repo's `retryPolicy.ci` (default 3): loop back to step 7 (re-check local e2e
      before re-waiting on CI). At/above the cap: **[CLI]**
      `kanban-cli move <item.id> Blocked --note "..."` (name the failing check and a
      short excerpt of the actual failure, not just "failed N times") and stop this
      item.
    - `result.status: "timeout"`: **[Claude]** judge whether to wait longer (re-issue
      `ci wait`) or treat it as needing investigation — a judgment call, not automatic.
    - `result.status: "success"`: continue.
12. **[Claude]** Final sanity check on the PR as a whole — the user has already
    approved full autonomy for merging once CI + review + e2e all pass, so this step
    is "confirm nothing looks anomalous," not a request for sign-off.
13. **[CLI]** `kanban-cli pr merge <item.repo> <prNumber>` → capture `mergeCommitSha`
    from the result. **[CLI]**
    `kanban-cli update <item.id> --set-merged-commit <sha> --kanban <board>`.
14. **[CLI]** `kanban-cli deploy wait <item.repo> --workflow <deployWorkflowName>
    --commit <mergeCommitSha> [--timeout <ms>]` (workflow name and timeout come from
    `repo-check`'s `config.deploy`).
    - `result.status: "failure"`: **[Claude]** investigate the deploy workflow's logs.
      **[CLI]** `kanban-cli update <item.id> --inc-retry deploy`. Below
      `retryPolicy.deploy` (default 2): decide on a fresh follow-up fix through the
      normal loop (this is post-merge, so treat it as a new small iteration, not a
      blind re-wait). At/above the cap: **[CLI]**
      `kanban-cli move <item.id> Blocked --note "..."` flagged as an infra issue, stop
      this item.
    - `result.status: "success"`: continue.
15. **[CLI]** `kanban-cli e2e live <item.repo> --url <targetEnvironment baseUrl from
    config.environments>` (always scoped to `config.e2e.smokeGrep` unless you pass
    `--grep` explicitly — never run the full suite against production).
    - `result.passed: false`: **the user's policy is to auto-revert on a live
      failure, not to keep autonomously patching production.**
      1. **[CLI]** `kanban-cli pr revert <item.repo> --commit <mergeCommitSha> --base
         main --title "<original PR title>" --pr-number <prNumber> --summary "<why:
         the live smoke check failure, e.g. failing test name/error>"`.
      2. **[CLI]** `kanban-cli ci wait <item.repo> <revertPrNumber>` — confirm the
         revert itself applies cleanly and builds.
      3. **[CLI]** `kanban-cli pr merge <item.repo> <revertPrNumber>` — autonomous;
         restoring known-good state is safe by definition, no separate sign-off needed.
      4. **[CLI]** `kanban-cli deploy wait <item.repo> --workflow <deployWorkflowName>
         --commit <revertMergeCommitSha>`.
      5. **[CLI]** `kanban-cli e2e live <item.repo> --url <baseUrl>` once more, to
         confirm the revert actually restored the working state. If this *also*
         fails, note that as an infra-level anomaly distinct from a code regression
         when you write the blocked note below.
      6. **[CLI]** `kanban-cli update <item.id> --set-revert-pr <revertPrNumber>
         --kanban <board>`, then **[CLI]**
         `kanban-cli move <item.id> Blocked --note "Live smoke check failed
         post-deploy (<what failed>); auto-reverted merge <sha> via PR
         <revertPrNumber>. Needs investigation before re-attempting." --kanban <board>`.
      The item does **not** go to Done — the acceptance criteria were never actually
      satisfied live. Stop this item, go back to step 1.
    - `result.passed: true`: continue.
16. **[CLI]** `kanban-cli move <item.id> Done --kanban <board>` and
    `kanban-cli update <item.id> --complete --kanban <board>` (only reached on a clean
    pass through step 15).
17. **[Claude]** Give a short summary of what shipped for this item, then go back to
    step 1 for the next Backlog item.

## Why retries live in the board file, not your memory

`retries.*` on each item persists across Claude Code sessions/compaction — the whole
point of storing it in the file is that a session restarting mid-board doesn't forget
how many times an item has already failed a given gate. Always read the current count
via `kanban-cli show <id>` before deciding whether to retry or block; don't estimate
it from conversation context.

## One stuck item never stalls the board

`kanban-cli next` only ever looks at the `Backlog` column, so once an item is moved to
`Blocked` it's automatically skipped on the next iteration — move on to the next
Backlog item rather than getting stuck.
