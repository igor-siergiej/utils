---
name: triaging-blocked-cards
description: Walks every Blocked jott task across the user's projects, gathers the context behind each block, asks the user one decision per card with a recommendation, and applies the answers in jott. Use when the user says "triage blocked cards", "go through the blocked items", "unblock the board", "what's stuck on my boards", or similar.
---

# Triaging blocked cards

Blocked cards mostly wait on a human decision, not on code. This skill turns
each one into a single, well-framed question, then writes the answer back to
jott, so a pile of Blocked cards clears in one sitting.

It never implements anything. Unblocked cards go back to Backlog for the
`kanban-worker` skill to pick up.

## Locate tasks and CLI

- Tasks live in jott (`jott` on PATH, DB synced with `jott sync`). All calls
  take `--json`; tasks are `#N`. If the user names one project, add
  `--project <P>` to the list below and triage only that one.
- Repo checkouts: `kanban-cli resolve-repo <P>` → `repo` (`kanban-cli` on PATH,
  else `bunx --bun @imapps/kanban-cli`).

## 1. List

```sh
jott sync --json
jott task list --status blocked [--project <P>] --json
```

jott writes stay local until `jott sync --json`; nothing syncs automatically.
If sync fails (offline, token rejected), report it to the user, and continue
with reads only if they agree.

Each row carries `number`, `title`, `project`, `tags` and `meta`:
`meta.blocked_reason`, `meta.retries`, and when set `meta.pr`,
`meta.revert_pr`, `meta.branch`, `meta.merged_commit`. Rows have no body; read
it with `jott task show <N> --json` (`task.body`).

Nothing blocked: say so and stop.

## 2. Gather context per card

For each card, build a short picture of **why it is blocked now**. The
`blocked_reason` was written at the time; check whether it still holds:

- `meta.pr` / `meta.revert_pr` set: `gh pr view <n> --json state,mergedAt,statusCheckRollup`
  in the project checkout (resolve it with `kanban-cli resolve-repo <P>`).
- The reason names a dependency on another card: `jott task show <N>
  --json` for that card. If it is Done, the block may be gone.
- The reason names a failing check, missing config, missing secret or a
  precondition (e.g. "only worth doing once X"): verify it cheaply and
  read-only (grep the repo, `gh run list`, look up the config). Never run
  anything against production, and never fetch secret values.
- Read the card body (`jott task show <N> --json`) for acceptance criteria the decision affects.

Keep it read-only and quick: a minute of checking per card, not an
investigation. If a card needs real debugging, that becomes the
recommendation ("unblock with a debugging-first criterion").

## 3. Ask

Use `AskUserQuestion`, up to 4 cards per call, one question per card, in list
order. Each question:

- **question:** `[<project>] <title>: <the decision needed>?` One line that
  names the actual choice, not "what should we do with this card?".
- **header:** short project or card tag (max 12 chars).
- **options** (2-4, recommended first with " (Recommended)"), picked from:
  - **Unblock to Backlog**, with the concrete amendment, e.g. "use Recraft,
    $0.04/icon cap". Description says what changes in the card.
  - **Split**: name the smaller card(s) that can proceed now and what stays
    blocked.
  - **Drop**: move to Done as won't-do. Description says why it is reasonable.
  - **Keep Blocked**: with the new, sharper reason (e.g. waiting on a specific
    person or date).
- Each option's description carries the context the user needs to choose
  without opening the task: 1-2 lines on what you found in step 2 (e.g.
  "PR #85 merged; only the Mongo 7 half remains").

The user can answer "Other" with free text. Treat that as the decision and
apply it as closely as the actions below allow. Ask a follow-up only if it is
genuinely ambiguous.

## 4. Apply

Per answered card (`<N>` is its number, `<P>` its project):

| Decision | Actions |
|---|---|
| Unblock | Write the amended body (amend acceptance criteria, record the decision and date) with `jott task set <N> --body - --json <<'EOF' … EOF` (full new body), then `jott task set <N> --status backlog --unmeta blocked_reason --meta retries='{"implement":0,"e2e_local":0,"ci":0,"deploy":0,"e2e_live":0}' --json`. |
| Split | Add each new card with `jott task add "<title>" --project <P> --status backlog --tag … --body - --json <<'EOF' … EOF`. Then update the original's body via `--body -` and either keep it Blocked with the remaining reason or drop it. |
| Drop | Append a `**Dropped <YYYY-MM-DD>:** <reason>` line to the body (write the full new body via `jott task set <N> --body - --json`), then `jott task set <N> --status done --json`. Do not set `completed_at`, since it never shipped. `blocked_reason` is kept as history. |
| Keep Blocked | Update the reason: run the "Blocking a task" command above with the new reason. |

Change only that card and the new cards for a split. Never touch other tasks.

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
heredoc is expanded. Keep Blocked uses this command.

After applying the decisions, run `jott sync --json`.

## 5. Report

End with a short summary per project: unblocked (and the amendment), split,
dropped, still blocked. Then the count left in Blocked. If anything was
unblocked, offer once to run `kanban-worker` on that project.
