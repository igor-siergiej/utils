---
name: refining-kanban-captures
description: Use when asked to refine jott Inbox tasks (a project's captures, or the project-less global inbox) into proper Backlog items - "refine the board", "refine the inbox", "drain the inbox", "refine my captures", "turn my notes into cards" - for a back-and-forth chat on one card: "refine <project> #N", "let's refine #N", and in factory mode, when the jott factory dispatcher hands it one card to refine headless. Investigates the target repo before promoting anything, so a promoted item carries grounded acceptance criteria instead of restated wishes.
---

# Refining Kanban Captures

## Overview

Inbox tasks in jott (`status: inbox`) are raw captures — one-line thoughts typed
from a phone. This skill turns them into real Backlog tasks, or reports them as
already done. Every `jott` call takes `--json`; tasks are `#N`.

**A capture is one sentence of intent. An item is a contract.** The gap between
those two is filled by reading the repo, never by rephrasing the capture.

**Never built automatically.** The `kanban-worker` loop ignores Inbox tasks
entirely: a capture becomes work only when a human moves it to Todo, after a
refinement pass they asked for and saw the result. The factory dispatcher may
run this skill on one card at a time (see Factory Mode), but a refined capture
still lands in Backlog — a human queues it.

## Step 0: The Global Inbox (if asked to "refine the inbox")

Inbox tasks with no project are the global inbox:
`jott task list --status inbox --json`, keeping rows whose `project` is empty.
A capture may carry a `#<project>` hint. Route each one first, then refine it as
below:

| Capture is about | Route to |
|---|---|
| a jott project (hint, or obvious from wording; see `jott task projects --json`) | choose that project: it is set with `--project <P>` when promoting in step 4; run steps 1-4 for it |
| design/idea thinking for a topic with a freeform plain note (see `<notes_dir>/kanban/index.md` Plain notes table, today `kanban/cycling-app.md`); actionable items belong in a jott project instead | hand-edit that note file (plain notes are not in jott; follow the `notes-kanban` skill), then `jott task rm <N> --json` |
| a new project / someday idea | add a bullet under `## Project ideas` in `<notes_dir>/kanban/index.md` by hand, then `jott task rm <N> --json` |
| unclear | leave it in the inbox and ask |

Remove a capture (`jott task rm`) only after its text has landed at its
destination — re-read the note file and confirm the text is there first.
Check `jott task projects --json` and `kanban/index.md` — never guess a project
or note name.

## The Procedure

### 1. List the captures

```bash
jott sync --json
jott task list --status inbox [--project <P>] --json
```

jott writes stay local until `jott sync --json`; nothing syncs automatically.
Run it again after promoting or dropping. If sync fails (offline, token
rejected), report it to the user, and continue with reads only if they agree.

Without `--project` this is every capture, including the global inbox. Rows
carry `number`, `title`, `project`, `tags`; read the full text with
`jott task show <N> --json` (`task.body`).

### 2. Resolve the checkout

The project resolves to a local clone: `kanban-cli resolve-repo <P>` → `repo`.

**If it fails with `RepoResolutionError`, the project has no local checkout** (an archived or
un-cloned repo). Report that and STOP — do not promote. You cannot write
acceptance criteria for code you cannot read.

### 3. Investigate — this is the actual work

For each capture, before writing a single word of the item, establish:

- **Does the feature already exist?** Search for it. Read the components,
  services and routes involved.
- **Was it already shipped?** Check merged PRs touching that surface.
- **What is the current behaviour, exactly?** File paths, symbol names, the
  classNames or state flags that produce the behaviour being complained about.
- **What already exists that must not be rebuilt?** Test infrastructure,
  adjacent components, a confirm step that is already there.

Evidence that this step is load-bearing, from one real pass (2026-09-20,
shoppingo):

- A capture asking to "add some snapshots so we don't regress again" was
  **already fully shipped** — a `desktop-visual` Playwright project with
  committed baselines, gating every PR. Promoting it verbatim would have
  commissioned work that already existed.
- The same review found **five merged PRs still parked in `In Progress`**, and
  a backlog item whose four acceptance criteria were all satisfied.
- Half of another capture ("does this work for multiple users?") was answered
  by reading the repo: per-user scoping throughout. Only the other half
  (a demo surface) was real work.

### 4. Choose an outcome

**Outstanding** — promote it:

```bash
jott task set <N> --title "<title>" --status backlog [--project <P>] \
    --tag <area> --tag P2 --body - --json <<'EOF'
<full body>
EOF
```

Always pass the body via `--body -` with a quoted heredoc. A grounded body is
multi-paragraph with backticks and newlines, which do not survive shell
argument quoting. `--project` is required when promoting a global-inbox task.
Promoted tasks land in Backlog, the user's pool of refined ideas; the
`kanban-worker` only picks up `todo`, so the user moves a card there (or asks you
to) when they want it worked.

The body states, in order:
1. The current behaviour, with file paths and symbol names.
2. What is already in place and must NOT be rebuilt.
3. `**Acceptance criteria**` — observable, verifiable outcomes.

Tags always include a priority: `P1` critical, `P2` normal, `P3` someday.

**Already shipped** — do not promote. Report it with evidence (PR number, file
path) and recommend:

```bash
jott task rm <N> --json   # reason: already shipped in #142 (state it in the summary)
```

The human decides whether to drop it. Never drop a capture unasked.

**Partially shipped** — promote a narrowed item covering only the outstanding
part, and say in the body which part is already done and where. Do not carry
forward acceptance criteria that are already satisfied.

## Interactive Mode (one card)

Triggered by a single card reference: "refine tandra #42", "let's refine #42".
Usually started from the phone (Claude app over Remote Control), in a fresh
session per card. It is a conversation, not a batch: the user is working out
what they actually want, so the questions are the point.

1. **Load the card.** `jott sync --json`, then `jott task show <N> --json`.
   - `inbox` or `backlog`: continue.
   - `todo` or later: refuse. Say the card is already queued for a worker (or
     past that), and that refining it now would change a contract a worker may
     be holding. Offer to move it back to `backlog` first if they want to
     rework it.
2. **Investigate before the first question** (steps 2 and 3 of the procedure:
   resolve the checkout, read the code). Every question must come from what
   the repo shows, never from a blank page.
3. **Ask one question per message.** Open questions first ("walk me through
   the last time this bit you"); offer a short menu only if they are stuck.
   Plain words, no process jargon. Use what you found: "Today `ListPage`
   drops the filter on refresh. Is that the bug, or is it the missing filter
   on the recipes page?"
4. **Play back before writing.** Once intent is clear, restate it in a few
   lines (what changes, for whom, what is out of scope) and ask what is wrong
   or missing.
5. **Write it** when the user says "write it" (or "go", "looks good"), or when
   nothing important is left to ask:

   ```bash
   jott task set <N> --title "<title>" --status backlog [--project <P>] \
       --tag <area> --tag P2 --body - --json <<'EOF'
   <full body>
   EOF
   jott sync --json
   ```

   The body follows the Backlog format from step 4 (current behaviour, what
   must not be rebuilt, `**Acceptance criteria**`), then adds `**Out of
   scope**`, `**Risks**`, and a `## Decisions` list: each of the user's answers
   that shaped the card, quoted briefly ("Only the shopping list, not
   recipes").

Rules:

- **"Just write it" at any point** (including the first question): stop asking
  and write the body from the investigation alone. Mark guesses in
  `## Decisions` as yours ("My call: P2").
- **Card already in Backlog with a body:** revise it. Keep its acceptance
  criteria unless the user drops or changes one, and say which ones changed.
- **Nothing is written until step 5.** If the session ends mid-chat, the card
  stays exactly as it was. No partial bodies, no status changes.
- Never move the card past `backlog`. The user marks it Go or moves it to
  `todo` when they want it worked.

## Factory Mode (dispatcher, one card)

The jott factory dispatcher can hand this skill one card to refine, headless:
"Use the refining-kanban-captures skill in factory mode for `<P>` #`<N>`." There is
no chat and no human in the loop. The card is in `inbox` or `backlog`, and the run
ends when the card is written (the dispatcher sees `meta.refined_at`) or when the
card is blocked with a question (the dispatcher sees `blocked_reason`).

Everything from the procedure above applies — investigate the repo, ground the
body in real files, keep the capture's own wording. These are the differences:

1. **Route first.** A card without a project is routed before anything else: pick
   the project from the capture and the checkouts under the repo roots
   (`KANBAN_CLI_REPO_ROOTS`, default `$HOME`) and set it with
   `jott task set <N> --project <P> --json`. Then read that project's code — the
   current directory when the dispatcher already gave you the project (it is a
   worktree of it), otherwise `kanban-cli resolve-repo <P>` → `repo`. If you cannot
   tell which project the capture belongs to, block it with that as your one
   question (step 3) instead of guessing — the run then ends and you are asked again
   with the answer.
2. **Investigate** (step 3 of the procedure): read the code, establish the current
   behaviour, what is already shipped, and what must not be rebuilt.
3. **One question, by blocking.** When the intent is genuinely unclear and the
   repo cannot answer it, block the card with that single question and end the
   run. The dispatcher reads the reason out of the card and hands it back to you
   in the next run ("Igor answered your block: …").

   ```sh
   jott task set <N> --status blocked --json --meta blocked_reason="$(jq -Rs 'rtrimstr("\n")' <<'EOF'
   <the one question>
   EOF
   )"
   jott sync --json
   ```

   The reason goes verbatim between the heredoc lines — it may hold backticks,
   quotes and newlines. Ask one thing: "Which project is this about?" is a
   question, "Describe what you want" is not.
4. **Already shipped?** Block the card with the evidence (PR number, file path)
   and end the run. Never delete a card in factory mode: the human decides what
   happens to it.
5. **One chunk** — the capture is one piece of work. Rewrite the card in place in
   the Backlog format of step 4 (current behaviour, what must not be rebuilt,
   `**Acceptance criteria**`), plus `## Decisions` listing your own calls:

   ```sh
   jott task set <N> --title "<title>" --status backlog --tag <area> --tag P2 \
       --meta refined_at="\"$(date -u +%FT%TZ)\"" --body - --json <<'EOF'
   <full body>
   EOF
   jott sync --json
   ```

   `refined_at` is how the dispatcher knows the card was written, so it goes in
   the same write as the body.
6. **Several chunks** — the capture is more than one PR. Create one Backlog card
   per chunk, in the order they must ship, each small enough to ship on its own:

   ```sh
   jott task add "<title of chunk k>" --status backlog --tag <area> --tag P2 \
       --project <P> --body - --json <<'EOF'
   <body of chunk k>
   EOF
   jott task set <new number> --meta after="\"<id of chunk k-1>\"" \
       --meta refined_from="\"<id of the parent card>\"" --json
   jott sync --json
   ```

   The chain is on **ids**, not numbers: chunk k>1 waits for chunk k-1, so once
   the chunks are queued the factory builds them in order and never two at once.
   (Queuing them is the user's call — a Backlog card is not work.) Every chunk
   carries `refined_from` = the parent's id. `jott task add --json` prints the new
   card, ids included. Then the parent gets the summary and is done:

   ```sh
   jott task set <N> --body - --status done \
       --meta refined_at="\"$(date -u +%FT%TZ)\"" --json <<'EOF'
   <parent body>

   Refined into #<a> → #<b> → #<c>
   EOF
   jott sync --json
   ```
7. **Never `todo`.** A refined card goes to Backlog; the user moves it to Todo
   when they want it worked.

## Anti-Patterns

| Anti-pattern | Why it is wrong |
|---|---|
| Writing acceptance criteria from the capture's wording alone | That is transcription, not refinement. The item must name real files. |
| Promoting a capture whose feature already exists | Commissions duplicate work. Check before promoting, every time. |
| "Add tests for this" as an acceptance criterion | Check whether the test infrastructure already covers it — it often does. |
| Promoting when `resolve-repo` finds no checkout | You have not read the code. Report the missing checkout instead. |
| Inventing a priority | Ask, or infer from the capture's own urgency; never leave it untagged. |
| Splitting one capture into several items silently | Fine to do, but say so — the human captured one thought. |
| Promoting into the global inbox without a project | Choose `--project` when promoting; a task with no project is never worked. |
| Interactive mode: asking several questions in one message | The user answers on a phone, one thumb. One question, one answer. |
| Interactive mode: writing the card before the play-back | The play-back is where wrong assumptions surface. Write only after it. |
| Promoting straight to `todo` | Backlog is the default; only set `--status todo` when the user asks for the card to be worked. |
| Factory mode: deleting a card | Nobody is watching. Block it with the evidence and let the human decide. |
| Factory mode: refining into `todo` | A refined card waits in Backlog until a human queues it. |
| Factory mode: asking a question in the body of the card | A question blocks the card (`blocked_reason`); the answer comes back to the next run. |

## Inbox Rules You Must Respect

- Inbox tasks are captures, not items. Never set one to `in-progress`; promote
  it to `backlog` first.
- Captures are stored verbatim. Keep the original wording in the body when
  promoting if it adds context.
