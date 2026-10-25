---
name: kanban-worker
description: Autonomously works a jott project's Todo tasks against that project's single local checkout — implements the item, runs Playwright e2e locally as a merge gate, opens a PR, reviews it, waits for CI, merges, waits for deploy, runs a live smoke check, and reverts+blocks if that fails. Use when the user says "work the kanban board", "pick up the next todo item", "run the kanban worker", or similar.
---

# Kanban worker

Drives a jott project's Todo column to completion, one task
at a time, worked against that project's single local checkout. Deterministic steps are delegated to
the `kanban-cli` CLI (shipped alongside this skill in `@imapps/kanban-cli`); anything
requiring judgment — implementing code, debugging failures, writing e2e assertions,
reviewing the diff, deciding when something is genuinely blocked — is done directly
by you, the agent running this skill.

## Locating the CLI

Check, in order: `command -v kanban-cli`, then `bunx --bun @imapps/kanban-cli --help`.
If neither works, tell the user it needs installing (`bun add -g @imapps/kanban-cli`
or as a devDependency of a repo) before continuing. All examples
below assume the binary is on PATH as `kanban-cli`; substitute the bunx form if not.

Every `kanban-cli` command prints one JSON object to stdout on success, or
`{"ok":false,"error":"..."}` to stderr with a non-zero exit code on a CLI-level
failure (bad args, missing file, `gh` not installed/authenticated). A **domain-level**
outcome — e2e tests failed, CI failed, a health check timed out — is NOT a CLI-level
failure: those come back as `ok:true` with a `result`/`status` field describing what
happened. Always branch on that field, not on exit code, to decide whether to retry,
debug, or block.

## Tasks live in jott

Work items are jott tasks, not a markdown board. `jott` must be on PATH and its
DB synced (`jott sync`). A project is a jott `--project <P>`; tasks are
referred to as `#N` (their `number`). Pass `--json` on every `jott` call and
parse the JSON it prints. `jott task list --json` rows carry `number`,
`title`, `project`, `status`, `tags`, `meta` (no body); `jott task show <N>
--json` adds `task.body`. Statuses: `inbox`, `backlog`, `todo`, `in-progress`,
`blocked`, `done`. Worker state lives in `task.meta`: `branch`, `pr`,
`merged_commit`, `revert_pr`, `blocked_reason`, `completed_at`, `retries`
(an object of per-gate counts; missing = all 0).

**Blocking a task.** `blocked_reason` is free text (CI excerpts may hold
backticks, `$(…)`, `$VAR`, quotes, backslashes, newlines), so always write it
through a quoted heredoc and jq:

```sh
jott task set <N> --status blocked --json --meta blocked_reason="$(jq -Rs 'rtrimstr("\n")' <<'EOF'
<reason>
EOF
)"
```

The reason goes verbatim between the heredoc lines; nothing inside a quoted
heredoc is expanded. Every "block `<N>`" below means this command.

**Sync.** jott writes stay local until `jott sync --json`; nothing syncs
automatically. Run it before listing and after every status change or batch of
meta writes. If sync fails (offline, token rejected), report it to the user,
and continue with reads only if they agree.

The checkout for project `<P>` comes from **[CLI]** `kanban-cli resolve-repo <P>`
→ `repo`. It resolves by scanning `KANBAN_CLI_REPO_ROOTS` (default `$HOME`,
up to two levels deep) for a `.kanban-cli.json` whose `repoName` is `<P>`.
If it reports a `RepoResolutionError`, tell the user to set that env var to
the directory holding their checkouts, or to fix the `repoName` in the repo's
`.kanban-cli.json`. If `task.meta.repo_url` is set, run `kanban-cli clone <P>
--url <repo_url>` first instead: it clones the project into the first repo
root, then it resolves (follow up with `kanban-cli init-config` if the fresh
clone has no full config).

**Inbox and Backlog tasks are not work.** Tasks with status `inbox` are raw captures.
You must never implement, promote or delete one. Turning a capture into a
Backlog task is a human-invoked job for the `refining-kanban-captures` skill.
Backlog is the user's pool of refined ideas: the user moves a card to `todo` when
they want it worked. Only work Backlog cards when the user explicitly asks for that
in this run (e.g. "work the backlog for <P>"); then list `--status backlog` in step 1.

## Per-item loop

Repeat from step 0 until the Todo list in step 1 is empty, then stop and report
a summary of what was completed/blocked this session.

**[CLI]** = shell out to kanban-cli or jott (deterministic, no judgment). **[Claude]** = your
own reasoning/tool use.

0. **[CLI]** `kanban-cli usage-check`. This reads a state file that a companion
   line in the user's statusline hook keeps fresh with the Claude subscription's
   rolling 5-hour usage window — it has nothing to do with this project or repo.
   - `result.status: "pause"`: the window is past the safety threshold (default
     90%). **[Claude]** Do not start step 1 / new item work. Write a short
     summary of what shipped or is still `In Progress` this session (do **not**
     move or touch the in-flight item — this check only gates the boundary
     *between* items). Then schedule the resume, depending on harness:
     - **Claude Code** (has `ScheduleWakeup`): call it with `delaySeconds`
       from `result.resetsAt` (clamp to [60, 3600]; if `resetsAt` is more than
       an hour out, this Step 0 check just re-fires and re-schedules on the
       next wake until the window has actually reset).
     - **omp** (no `ScheduleWakeup`): run
       `echo 'omp -p "work the kanban board for <P>"' | at <resetsAt as local time>`
       (fall back to `systemd-run --user --on-calendar=<resetsAt>` if `at` is
       missing), confirm it queued, and report the time.
       `retry.waitForUsageReset: true` additionally lets a live omp session
       sleep through a hard 429 and resume, but does not replace this gate.
     Then end your turn. Do not attempt to keep working past this point.
   - `result.status: "ok"` or `"unknown"`: continue to step 1 as normal.
     (`"unknown"` means no fresh usage telemetry is available — e.g. the
     statusline hasn't rendered recently, or the user hasn't wired up
     `record-usage` — proceed rather than block indefinitely on missing data.
     If the result carries a `hint`, pass it on to the user once: it means
     `record-usage` was never wired up, so this gate can never pause.)

1. **[CLI]** `jott sync --json`, then `jott task list --project <P> --status todo --json`. If `tasks` is
   empty, the project has no more actionable work — stop here (Backlog cards wait
   for the user to move them to Todo). Otherwise take the
   first row's `number` as `<N>` and run `jott task show <N> --json` (`task.meta`,
   `task.body`). Then `kanban-cli resolve-repo <P>` → `repo` (see "Tasks live in
   jott" for `RepoResolutionError` / `meta.repo_url`).
2. **[CLI]** `kanban-cli repo-check <repo>`.
   - If it fails with a `RepoConfigError` (`{"ok":false,...}`): the repo's
     `.kanban-cli.json` exists (step 1 already resolved the checkout via its
     `repoName`) but is missing required keys. **[Claude]** help the user fill
     the missing keys. Start with **[CLI]** `kanban-cli init-config <repo>
     [--base-url <prod url>]`: it fills whatever it can infer from the repo
     without overwriting existing values and lists the rest under `missing`;
     fill those from the README schema (dev start/teardown commands, health-check
     URL, e2e test command, CI workflow name(s), deploy workflow name,
     staging/prod base URL), and check its inferred values are right. This is
     one-time per repo, not per item; re-run `repo-check` after to confirm it
     validates, then continue.
   - If `playwrightConfigured: false`: **[CLI]** `kanban-cli e2e bootstrap <repo>`,
     then **[Claude]** review the scaffolded config/spec and adjust it to fit the app
     before relying on it.
3. **[CLI]** `jott task set <N> --status in-progress --json`, then `jott sync --json`.
4. **[Claude]** Read `task.title`/`task.body` (acceptance criteria live there).
   Explore `<repo>`'s codebase with your own tools, cd'd into that repo, and
   implement the change directly in that checkout.
5. **[Claude]** Create a branch in `<repo>` and write/update Playwright spec(s)
   covering the acceptance criteria. Tag any that are cheap and safe enough to also
   run post-deploy against production with `@smoke`.
6. **[CLI]** `jott task set <N> --meta branch='"<branch>"' --json`.
7. **[CLI]** `kanban-cli e2e local <repo> [--grep <new-spec-pattern>]` — starts
   the app per `.kanban-cli.json`'s `dev` config, health-checks it, runs the e2e
   command, always tears down.
   - `result.passed: false`: **[Claude]** read `result.failedTests`, debug and fix
     (either the app code or the spec itself). **[CLI]** Read `task.meta.retries`
     via `jott task show <N> --json` (missing = all 0), add 1 to `e2e_local`, and
     write the whole object back with `jott task set <N> --meta retries='<json>' --json`.
     If the new retry count is
     `>=` the repo's `retryPolicy.e2e_local` (default 3, from `repo-check`'s
     `config.retryPolicy`), **[CLI]**
     block `<N>` (see "Blocking a task") with reason "<specific last-failure summary>", then `jott sync --json`, and
     stop working this item (go back to step 1 for the next one). Otherwise, loop
     back to step 7.
   - `result.passed: true`: continue.
8. **[Claude]** Commit (conventional commit message) and push the branch.
   If the repo's `.kanban-cli.json` has `"releaseNotes": true`, end the commit body
   with a `Release-Notes:` trailer — one sentence, written for the people who use
   the app, not for the people who maintain it:

   ```
   feat(web): Waste Warrior becomes a full page instead of a drawer

   <the usual technical body>

   Release-Notes: Use-it-up ingredient search is now a full page, so results
   aren't squashed behind the keyboard.
   ```

   Repeat the same trailer at the end of the PR body in step 9, so it survives
   whichever message GitHub composes on squash-merge. Name the user-visible
   change and why it is better; skip the file names, component names and
   refactoring. An item with no user-visible effect at all (pure chore) simply
   omits the trailer.
9. **[CLI]** `kanban-cli pr create <repo> --title <t> --body <b> --base main --head <branch>`.
   **[CLI]** `jott task set <N> --meta pr=<number> --json`, then `jott sync --json`.
10. **[Claude]** Review your own diff for correctness, style, and risk (equivalent to
    `/code-review`, applied to the PR you just opened). Fix anything you find, push
    again, and re-run step 7 if the fix touched application code (not just docs/PR
    description). This is ordinary iterative development, not a bounded retry gate.
11. **[CLI]** `kanban-cli ci wait <repo> <prNumber> [--timeout <ms>]`.
    - `result.status: "failure"`: **[Claude]** pull the failing job's logs (`gh run
      view --log-failed` or the GitHub MCP tools available in this session), debug,
      fix, push. **[CLI]** increment `ci` in `task.meta.retries` (read via
      `jott task show <N> --json`, write the whole object back with
      `jott task set <N> --meta retries='<json>' --json`). Below the
      repo's `retryPolicy.ci` (default 3): loop back to step 7 (re-check local e2e
      before re-waiting on CI). At/above the cap: **[CLI]**
      block `<N>` (see "Blocking a task") with reason "..." (name the failing check and a
      short excerpt of the actual failure, not just "failed N times"), then
      `jott sync --json`, and stop this item.
    - `result.status: "timeout"`: **[Claude]** judge whether to wait longer (re-issue
      `ci wait`) or treat it as needing investigation — a judgment call, not automatic.
    - `result.status: "success"`: continue.
12. **[Claude]** Final sanity check on the PR as a whole — the user has already
    approved full autonomy for merging once CI + review + e2e all pass, so this step
    is "confirm nothing looks anomalous," not a request for sign-off.
13. **[CLI]** `kanban-cli pr merge <repo> <prNumber>` → capture `mergeCommitSha`
    from the result. **[CLI]**
    `jott task set <N> --meta merged_commit='"<sha>"' --json`.
14. **[CLI]** `kanban-cli deploy wait <repo> --workflow <deployWorkflowName>
    --commit <mergeCommitSha> [--timeout <ms>]` (workflow name and timeout come from
    `repo-check`'s `config.deploy`).
    - `result.status: "failure"`: **[Claude]** investigate the deploy workflow's logs.
      **[CLI]** increment `deploy` in `task.meta.retries` (read via `jott task
      show <N> --json`, write the whole object back with `--meta retries='<json>'`). Below
      `retryPolicy.deploy` (default 2): decide on a fresh follow-up fix through the
      normal loop (this is post-merge, so treat it as a new small iteration, not a
      blind re-wait). At/above the cap: **[CLI]**
      block `<N>` (see "Blocking a task") with reason "..." flagged as an infra issue, then `jott sync --json`, and stop
      this item.
    - `result.status: "success"`: continue.
15. **[CLI]** `kanban-cli e2e live <repo> --url <targetEnvironment baseUrl from
    config.environments>` (always scoped to `config.e2e.smokeGrep` unless you pass
    `--grep` explicitly — never run the full suite against production).
    - `result.passed: false`: **the user's policy is to auto-revert on a live
      failure, not to keep autonomously patching production.**
      1. **[CLI]** `kanban-cli pr revert <repo> --commit <mergeCommitSha> --base
         main --title "<original PR title>" --pr-number <prNumber> --summary "<why:
         the live smoke check failure, e.g. failing test name/error>"`.
      2. **[CLI]** `kanban-cli ci wait <repo> <revertPrNumber>` — confirm the
         revert itself applies cleanly and builds.
      3. **[CLI]** `kanban-cli pr merge <repo> <revertPrNumber>` — autonomous;
         restoring known-good state is safe by definition, no separate sign-off needed.
      4. **[CLI]** `kanban-cli deploy wait <repo> --workflow <deployWorkflowName>
         --commit <revertMergeCommitSha>`.
      5. **[CLI]** `kanban-cli e2e live <repo> --url <baseUrl>` once more, to
         confirm the revert actually restored the working state. If this *also*
         fails, note that as an infra-level anomaly distinct from a code regression
         when you write the blocked note below.
      6. **[CLI]** `jott task set <N> --meta revert_pr=<revertPrNumber> --json`,
         then **[CLI]**
         block `<N>` (see "Blocking a task") with reason "Live smoke check
         failed post-deploy (<what failed>); auto-reverted merge <sha> via PR
         <revertPrNumber>. Needs investigation before re-attempting.", then `jott sync --json`.
      The item does **not** go to Done — the acceptance criteria were never actually
      satisfied live. Stop this item, go back to step 1.
    - `result.passed: true`: continue.
16. **[CLI]** `jott task set <N> --status done --meta completed_at="\"$(date -u +%FT%TZ)\"" --json`,
    then `jott sync --json` (only reached on a clean pass through step 15).
17. **[Claude]** Give a short summary of what shipped for this item, then go back to
    step 1 for the next Todo item.

## Single-card mode (factory dispatcher)

`kanban-cli dispatch` starts a run with a prompt naming one card ("single-card mode for <P>
#<N>") in a git worktree it created for that card. In this mode:

- Work only card `<N>`. The card is already `in-progress`, so skip steps 0, 1 and 3. The
  dispatcher owns the quota, and it pauses and resumes the run around rate limits.
- `<repo>` for steps 2 and 4–15 is the current directory (the worktree), not the path
  `resolve-repo` returns. Never `git checkout`, stash or commit in the main checkout.
- The branch already exists: skip creating one in step 5 and step 6's branch write.
- Report each gate as you reach it (`implementing`, `e2e`, `pr`, `ci`, `merging`, `deploying`,
  `smoke`) with `jott factory step <N> "<text>" --json`. It is an API call to the jott server, so
  no `jott sync` is needed; if it fails, carry on — the step is display only. It is what Igor sees
  on his phone.
- If the prompt carries "Igor answered your block", that answer resolves the earlier
  `blocked_reason`. Continue from the branch's current state.
- End the run after step 16 (or after blocking). The card must finish `done` or `blocked`:
  a run that leaves it `in-progress` counts as a failed attempt.

## Why retries live in `meta.retries`, not your memory

`meta.retries` on each task persists across Claude Code sessions/compaction — the whole
point of storing it in jott is that a session restarting mid-project doesn't forget
how many times an item has already failed a given gate. Always read the current count
via `jott task show <N> --json` before deciding whether to retry or block; don't estimate
it from conversation context.

## One stuck item never stalls the project

Step 1 only ever lists `--status todo`, so once a task is set to
`blocked` it's automatically skipped on the next iteration — move on to the next
Todo item rather than getting stuck.

## The usage-limit pause only gates between items

Step 0's `usage-check` only runs at the top-of-loop boundary. It will not
interrupt a single item's implementation, e2e run, or CI/deploy wait if that
one item's work happens to cross the threshold mid-flight — only the *next*
item is gated. This is intentional: every other checkpoint in this loop can
be mid-git-operation, mid-PR-review, or mid-poll, none of which are safe
points to abandon.
