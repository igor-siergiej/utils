---
name: refining-kanban-captures
description: Use when asked to refine a kanban board's raw captures into proper items - "refine the board", "drain the inbox", "refine my captures", "turn my notes into cards". Investigates the target repo before promoting anything, so a promoted item carries grounded acceptance criteria instead of restated wishes.
---

# Refining Kanban Captures

## Overview

A board's `## Inbox` holds raw captures — one-line thoughts typed from a phone.
This skill turns them into real `###` items, or reports them as already done.

**A capture is one sentence of intent. An item is a contract.** The gap between
those two is filled by reading the repo, never by rephrasing the capture.

**Never invoked automatically.** The `kanban-worker` loop ignores `## Inbox`
entirely. Captures become work only when a human asks for a refinement pass and
sees the result.

## The Procedure

### 1. List the captures

```bash
kanban-cli inbox list --kanban <board>
```

Returns 1-based indices:

```json
{"ok":true,"captures":[{"index":1,"text":"- Better loading when we import recipes"}]}
```

### 2. Resolve the checkout

Each board's `project` frontmatter resolves to a local clone. `kanban-cli show
<id>` on any existing item reports the resolved path as `repo`.

**If `repo` is empty, the project has no local checkout** (an archived or
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
kanban-cli inbox promote <index> --id <project>-<slug> --title "<title>" \
    --tags <area>,P2 --body-file /tmp/item-body.md --kanban <board>
```

Always pass the body via `--body-file`. A grounded body is multi-paragraph with
backticks and newlines, which do not survive shell argument quoting.

The body states, in order:
1. The current behaviour, with file paths and symbol names.
2. What is already in place and must NOT be rebuilt.
3. `**Acceptance criteria**` — observable, verifiable outcomes.

Tags always include a priority: `P1` critical, `P2` normal, `P3` someday.

**Already shipped** — do not promote. Report it with evidence (PR number, file
path) and recommend:

```bash
kanban-cli inbox drop <index> --reason "already shipped in #142" --kanban <board>
```

The human decides whether to drop it. Never drop a capture unasked.

**Partially shipped** — promote a narrowed item covering only the outstanding
part, and say in the body which part is already done and where. Do not carry
forward acceptance criteria that are already satisfied.

## Anti-Patterns

| Anti-pattern | Why it is wrong |
|---|---|
| Writing acceptance criteria from the capture's wording alone | That is transcription, not refinement. The item must name real files. |
| Promoting a capture whose feature already exists | Commissions duplicate work. Check before promoting, every time. |
| "Add tests for this" as an acceptance criterion | Check whether the test infrastructure already covers it — it often does. |
| Promoting when `repo` is empty | You have not read the code. Report the missing checkout instead. |
| Inventing a priority | Ask, or infer from the capture's own urgency; never leave it untagged. |
| Splitting one capture into several items silently | Fine to do, but say so — the human captured one thought. |
| Editing the board file by hand to remove a capture | Use `promote`/`drop` so the round-trip and the item schema stay intact. |

## Board Rules You Must Respect

- Raw prose is legal **only** under `## Inbox`. Anywhere else it is a hard
  `KanbanParseError` naming the line and the remedy. If you hit one, fix the
  board by moving the text into `## Inbox` — never by deleting it.
- `## Inbox` holds captures, not items. `kanban-cli move <id> Inbox` is
  rejected.
- Captures are stored verbatim, including any leading `- `. Both bullets and
  bare paragraphs are valid captures.
