---
name: triaging-blocked-cards
description: Walks every Blocked card across the user's kanban boards, gathers the context behind each block, asks the user one decision per card with a recommendation, and applies the answers to the board. Use when the user says "triage blocked cards", "go through the blocked items", "unblock the board", "what's stuck on my boards", or similar.
---

# Triaging blocked cards

Blocked cards mostly wait on a human decision, not on code. This skill turns
each one into a single, well-framed question, then writes the answer back to
the board, so a pile of Blocked cards clears in one sitting.

It never implements anything. Unblocked cards go back to Backlog for the
`kanban-worker` skill to pick up.

## Locate boards and CLI

- Boards: `/mnt/tank/shared/notes/kanban/*.board.md` on foundry. On another
  device, find the notes directory the way the `notes-kanban` skill does. If
  the user names one board, triage only that one.
- CLI: `kanban-cli` on PATH, else `bunx --bun @imapps/kanban-cli`. It needs
  `list` (added in 2.4.0). If `list` is unknown, tell the user to upgrade.

## 1. List

```sh
kanban-cli list --column Blocked --all-boards <boards-dir>
```

Each item carries `board`, `project`, `id`, `title`, `body`, `blockedReason`,
`retries`, and when set `pr`, `revertPr`, `branch`, `mergedCommit`. Report any
`errors` entries (an unparseable board) to the user and skip those boards; do
not edit them to fix the parse.

Nothing blocked: say so and stop.

## 2. Gather context per card

For each card, build a short picture of **why it is blocked now**. The
`blocked_reason` was written at the time; check whether it still holds:

- `pr` / `revertPr` set: `gh pr view <n> --json state,mergedAt,statusCheckRollup`
  in the project checkout (resolve it with `kanban-cli repo-check` or the
  `.kanban-cli.json` under `KANBAN_CLI_REPO_ROOTS`).
- The reason names a dependency on another card: `kanban-cli show <id>
  --kanban <board>` for that card. If it is Done, the block may be gone.
- The reason names a failing check, missing config, missing secret or a
  precondition (e.g. "only worth doing once X"): verify it cheaply and
  read-only (grep the repo, `gh run list`, look up the config). Never run
  anything against production, and never fetch secret values.
- Read the card body for acceptance criteria the decision affects.

Keep it read-only and quick: a minute of checking per card, not an
investigation. If a card needs real debugging, that becomes the
recommendation ("unblock with a debugging-first criterion").

## 3. Ask

Use `AskUserQuestion`, up to 4 cards per call, one question per card, in board
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
  without opening the board: 1-2 lines on what you found in step 2 (e.g.
  "PR #85 merged; only the Mongo 7 half remains").

The user can answer "Other" with free text. Treat that as the decision and
apply it as closely as the actions below allow. Ask a follow-up only if it is
genuinely ambiguous.

## 4. Apply

Per answered card, with `--kanban <board>` on every call:

| Decision | Actions |
|---|---|
| Unblock | Edit the card body (amend acceptance criteria, record the decision and date), then `kanban-cli move <id> Backlog`. Leaving Blocked clears `blocked_reason` and resets retries. |
| Split | Add the new card(s) to Backlog by hand-editing the board (same item format: `###` title, `- **id:**`, `- **tags:**`, `- **retries:**` all 0, body). Then update the original's body and either keep it Blocked with the remaining reason or drop it. |
| Drop | Append a `**Dropped <YYYY-MM-DD>:** <reason>` line to the body, then `kanban-cli move <id> Done`. Do not set `--complete`, since it never shipped. `blocked_reason` is kept as history. |
| Keep Blocked | Update the reason: `kanban-cli move <id> Blocked --note "<new reason>"` (a move within Blocked rewrites the note). |

Body edits are hand-edits of the board file, so:

- Change only that card's body, and the new cards for a split. Never touch other
  cards, the Inbox, or frontmatter.
- After each edit, run `kanban-cli show <id> --kanban <board>` to confirm the
  board still parses. If it doesn't, fix your own edit before continuing.
- The board syncs to the user's phone. Do edits per card, not as one big
  rewrite at the end.

## 5. Report

End with a short summary per board: unblocked (and the amendment), split,
dropped, still blocked. Then the count left in Blocked. If anything was
unblocked, offer once to run `kanban-worker` on that board.
