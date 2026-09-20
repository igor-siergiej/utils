# Kanban CLI — `## Inbox` captures and skill-driven refinement

**Status:** approved design, pre-implementation
**Date:** 2026-09-20
**Package:** `@imapps/kanban-cli` (0.11.0 → 1.0.0)

## Problem

Raw thoughts typed onto a board are silently destroyed.

`parseKanbanFile` (`src/kanban/parser.ts`) recognises exactly three things at
column scope: a `#` title, a `##` column heading, and a `###` item heading.
Every other line falls through to `i += 1` at line 104 and is discarded.
`serializeKanbanBoard` then rebuilds the file purely from the parsed model
(`src/kanban/serializer.ts:11-23`), so the discarded text is gone from disk the
next time any command writes.

Observed on 2026-09-20. `shoppingo.board.md` had two captures typed at the top
of `## Backlog` from a phone:

```
## Backlog

Can we fix desktop view of the recipes page and let's add in some snapshots for this so we don't regress again

Better way of showing loading when we import recipes
```

Running `kanban-cli move shoppingo-recipe-image-skeleton-stuck Done` against a
copy of that file removed both lines. They were also invisible to
`kanban-cli next` (it only returns `###` items), so the worker would never have
picked them up — they were unreachable *and* deletable.

There is also no path from a capture to a real item. Refining one requires
reading the target repo and deciding what is actually true: of the two captures
above, the "add some snapshots" half was **already fully shipped** (a
`desktop-visual` Playwright project with committed baselines, gating every PR),
and a review of the same board found five merged PRs still parked in
`In Progress`. A deterministic CLI cannot make those judgements; an agent with
repo access can.

## Goal

- A conventional place to drop raw prose on a board that round-trips through
  the CLI unchanged, byte for byte.
- Prose in the wrong place fails loudly instead of being dropped.
- Deterministic, unit-testable CLI plumbing to list, promote, and discard
  captures — no model calls inside the CLI.
- A skill that investigates the target repo before composing an item, so a
  promoted card carries grounded, file-level acceptance criteria and an
  already-shipped capture is caught rather than re-implemented.
- No change to how `next` / the worker loop selects work.

## Non-goals

- **Unattended draining.** The worker never refines captures on its own. A
  capture becomes an item only when a human invokes the refinement skill and
  sees the result. (Deliberately rejected: auto-refining inside the worker loop
  would hand an unreviewed acceptance-criteria set to the implementer, and the
  2026-09-20 review shows refinement frequently concludes "already shipped".)
- **Preserving prose outside `## Inbox`.** Considered and rejected in favour of
  erroring — see §2. `## Inbox` is the one legal home for raw text.
- **Making `## Inbox` a required column.** It stays optional; the five working
  boards do not have one and must keep parsing.
- **A global cross-project inbox.** Captures live on the project board they
  belong to, consistent with one `<project>.board.md` per project.
- Changing the required columns, item schema, or any existing command's JSON
  output.

## Design

### 1. File format and model

`## Inbox` is an optional column, conventionally first, that holds captures
instead of items:

```markdown
---
project: shoppingo
---

# Shoppingo Kanban Worker Board

## Inbox

- Better way of showing loading when we import recipes

Desktop view of the recipes page looks cramped — worth a look when
the grid work lands.

## Backlog

### recipes page: desktop layout squeezes the grid into a 500px column

- **id:** shoppingo-recipes-desktop-layout
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

...
```

A **capture** is one blank-line-separated block of non-heading text. Both
`- bullet` lines and bare paragraphs are accepted, and a block may span
multiple lines. Text is stored **verbatim**, including any leading `- `, and is
re-emitted unchanged: requiring a leading `- ` would mean a forgotten dash
silently loses the text, which defeats the section's purpose.

Types (`src/kanban/types.ts`):

```ts
export const INBOX_COLUMN = 'Inbox';

export interface KanbanColumn {
    name: string;
    items: KanbanItem[];
    captures: string[];   // new; always present, empty for non-Inbox columns
}
```

`captures` is non-optional so every construction site is forced to be explicit
and no consumer has to `?? []`. `REQUIRED_COLUMNS` is unchanged — `Inbox` is
not added to it.

### 2. Parsing — strict, with an actionable error

In the `parseKanbanFile` loop, the fall-through `i += 1` (line 104) is
replaced:

1. Blank line: if inside `Inbox`, it terminates the current capture block;
   otherwise skipped as today.
2. Non-blank, non-heading line while the enclosing column is `Inbox`: append to
   the current capture block.
3. Non-blank, non-heading line **anywhere else** — including before the first
   `##` column, and including text after an item's terminating `---` — throws
   `KanbanParseError`.

Item bodies are untouched: they are consumed by `parseItem`, still terminated
by a lone `---` or the next heading, and body prose stays legal.

The error must be actionable enough to fix from a phone, so it carries the line
number, the offending text (truncated), the column, and the remedy:

```
line 9: stray text 'Can we fix desktop view of the recipes page and let…' in
column 'Backlog'. Raw notes are only allowed under '## Inbox' — move it there,
or turn it into a '### item'.
```

Accepted consequence: a stray line blocks *every* command on that board,
including read-only `next`/`show`/`columns`, and therefore halts an unattended
worker run until it is fixed by hand. This is chosen deliberately over silent
data loss. The `kanban-worker` skill is updated to treat a `KanbanParseError`
as stop-and-report, never as a board it should attempt to repair.

**Migration.** Verified 2026-09-20: `shoppingo`, `jewellery-catalogue`,
`foundry`, `kanban-cli` and `taisei-karate` have zero column-scope prose and
are unaffected. `personal-portfolio.board.md` already fails to parse today for
an unrelated reason (pre-frontmatter format, no `project:` key) and still needs
`kanban-cli migrate`; this change neither fixes nor worsens it.

### 3. Mutations

`src/kanban/mutations.ts` gains three pure functions, mirroring the existing
`moveItem` style (return a new board, throw typed errors):

```ts
listCaptures(board: KanbanBoard): Array<{ index: number; text: string }>
dropCapture(board: KanbanBoard, index: number): KanbanBoard

interface PromotedItemFields {
    id: string;
    title: string;
    tags?: string[];
    body?: string;
}

promoteCapture(
    board: KanbanBoard,
    index: number,
    fields: PromotedItemFields,
    toColumn?: string,   // default 'Backlog'
): KanbanBoard
```

- `index` is 1-based, matching how `inbox list` prints them.
- Out-of-range index → `CaptureNotFoundError` naming the valid range.
- No `## Inbox` column → `CaptureNotFoundError` explaining the board has no
  Inbox section.
- `promoteCapture` removes capture N and appends the new item to `toColumn`
  (default `Backlog`), with all `retries` gates zeroed. Appending matches
  `moveItem`'s existing placement, so `next` order stays predictable.
- Duplicate `id` → the existing duplicate-id validation path, before any write.

`nextBacklogItem` (`mutations.ts:17`) is unchanged: it reads `Backlog` only, so
captures stay out of the worker loop with no new guard.

`moveItem` gains one guard: `Inbox` as a target throws, because the column
holds no items and serialising one there would produce a card the refinement
flow cannot see.

### 4. Serialization

`serializeKanbanBoard` emits, per column: the `## <name>` heading, then each
capture block verbatim separated by a blank line, then items exactly as today.
Round-trip is byte-identical for captures, and `parse → serialize → parse →
serialize` stays stable (the existing idempotence tests extend to captures).

### 5. Durable writes (scoped addition)

`writeKanbanBoard` (`src/kanban/io.ts:26`) is a bare `writeFileSync`. It is
changed to write a sibling temp file and `rename` it into place.

Two concrete reasons, both hit on 2026-09-20:

- The board lives on a Resilio-synced mount and is edited from a phone. A
  non-atomic rewrite can be observed, and synced, half-written.
- `rslsync` runs as root, so a board synced from another device lands as
  `root:root 644`. Every board in `/mnt/tank/shared/notes/kanban/` was
  root-owned this morning, and `writeFileSync` cannot open such a file for
  writing as the invoking user. A temp-file-plus-rename succeeds whenever the
  *directory* is writable, which it is (`home:home`), and leaves the result
  owned by the CLI's user.

Flagged explicitly as beyond the literal request: it is three lines, it removes
a class of failure the CLI will otherwise hit on this exact setup, and it is
approved separately from §1-§4.

### 6. CLI surface

```
kanban-cli inbox list    [--kanban <path>]
kanban-cli inbox promote <index> --id <id> --title <t> [--tags a,b]
                          [--body <text> | --body-file <path>]
                          [--column <name>] [--kanban <path>]
kanban-cli inbox drop    <index> [--reason <text>] [--kanban <path>]
```

Wired in `src/cli.ts` as an `inbox` subcommand group with its own usage string,
alongside the existing `e2e` / `pr` groups. New command modules
`src/commands/inboxList.ts`, `inboxPromote.ts`, `inboxDrop.ts`.

JSON output follows the existing convention — one object on stdout, `ok:true`
on success:

```jsonc
// inbox list
{"ok":true,"captures":[{"index":1,"text":"Better way of showing loading when we import recipes"}]}
// inbox promote
{"ok":true,"promoted":{"index":1,"text":"..."},"item":{"id":"shoppingo-...","column":"Backlog",...}}
// inbox drop
{"ok":true,"dropped":{"index":1,"text":"..."},"reason":"already shipped in #142"}
```

`--body-file` exists because a grounded body is multi-paragraph with embedded
backticks and newlines; passing it as a shell argument is unreliable. `--reason`
on `drop` is echoed in the JSON for the caller's log; it is not persisted to the
board, since the capture itself is removed.

Each command is one read-modify-write cycle via `readKanbanBoard` /
`writeKanbanBoard`. Concurrent editing (phone writing the same file mid-command)
is out of scope, unchanged from every existing mutating command.

### 7. The refinement skill

New skill `refining-kanban-captures`, invoked by a human ("refine the board",
"drain the inbox").

Procedure per capture, in order:

1. `kanban-cli inbox list` to enumerate captures.
2. Resolve the project's checkout (the board's `project`, via the existing
   `resolveRepoPath` behaviour surfaced as `item.repo`).
3. **Investigate before writing anything.** Read the relevant code; establish
   whether the capture is already shipped, partially shipped, or genuinely
   outstanding. Check merged PRs for the surface in question.
4. Then one of:
   - **Outstanding** → `inbox promote` with a title, tags including a
     `P1`/`P2`/`P3` priority, and a body stating the current behaviour with
     file paths and symbol names, what is already in place and must not be
     rebuilt, and acceptance criteria a worker can verify.
   - **Already shipped** → report it with evidence (PR number, file path) and
     recommend `inbox drop --reason`; the human decides.
   - **Partially shipped** → promote a narrowed item covering only the
     outstanding part, naming the shipped part as done.
5. Never promote without having read the repo. A capture is one sentence of
   intent; an item is a contract.

Anti-patterns to state in the skill: inventing acceptance criteria from the
capture's wording alone; promoting a capture whose feature already exists;
writing "add tests" as an acceptance criterion when the test infrastructure
already covers it.

### 8. Skill packaging

`installSkill` (`src/commands/installSkill.ts`) hardcodes one skill:
`skill/SKILL.md` → `<target>/kanban-worker/SKILL.md`. It is generalised for two.

- Package layout becomes `skill/kanban-worker/SKILL.md` and
  `skill/refining-kanban-captures/SKILL.md`.
- `kanban-cli install-skill --target <dir> [--skill <name>] [--symlink]`
  installs all packaged skills, or just the named one. The existing
  `already_installed` short-circuit becomes per-skill, so installing a new
  skill next to an existing one succeeds and reports each result.
- Return shape becomes `{ok:true, installed:[{skill,path,mode}], skipped:[...]}`.

The live copies are maintained in the dotfiles repo
(`/home/home/dotfiles/claude/.claude/skills/`, symlinked from
`~/.agents/skills/`), currently byte-identical to the package copy. Both skills
are updated there as part of this work so the shipped and installed copies stay
in sync.

### 9. Boards with no local checkout

`readKanbanBoard` resolves a checkout path on every read (`io.ts:15`) and
throws `RepoResolutionError` when the project has none. That makes a board
entirely unusable — including pure board reads that never touch code.

Demonstrated 2026-09-20 with `personal-portfolio.board.md`, whose repo is not
cloned (archived on GitHub, per that board's own first backlog item):

```
$ kanban-cli columns --kanban personal-portfolio.board.md
{"ok":false,"error":"No repo with repoName 'personal-portfolio' found under
/home/home (scanned up to two levels deep); set KANBAN_CLI_REPO_ROOTS ..."}
```

Without a change, `inbox list` inherits this: captures on a checkout-less
board could not even be read, let alone refined.

`readKanbanBoard` takes an option:

```ts
readKanbanBoard(path: string, opts?: { requireRepo?: boolean }): KanbanBoard
```

`requireRepo` defaults to `true`, so every existing caller is unchanged. When
`false`, a `RepoResolutionError` is swallowed and `item.repo` is set to `''`
for every item.

Commands that never touch a checkout pass `requireRepo: false`: `columns`,
`inbox list`, `inbox promote`, `inbox drop`. Commands that feed the worker
keep requiring it, because their consumer needs the path immediately: `next`,
`show`, `move`, `update`. `migrate` already bypasses `readKanbanBoard`
entirely and needs no change.

`KanbanItem.repo` stays a required `string` — `''` signals "not resolved"
without forcing every consumer to handle `undefined`. The refinement skill
(§7) treats an empty `repo` as "cannot ground this capture": it reports the
missing checkout and refuses to promote, rather than inventing acceptance
criteria for code it cannot read.

**`personal-portfolio.board.md` migration.** Run
`kanban-cli migrate personal-portfolio.board.md --project personal-portfolio`.
Verified on a copy 2026-09-20: all 7 items survive, the fenced-yaml blocks
become `- **key:**` bullets, and the two stale machine-specific `repo:` paths
(`/home/igors/imapps/personal-portfolio`, from another machine) are dropped —
which is the point of the format. An `## Inbox` heading is added at the same
time. After this, `columns` and `inbox list` work on it; `next`/`show` still
error until the repo is unarchived and cloned, which is correct.

### 10. Files

| File | Change |
| --- | --- |
| `src/kanban/types.ts` | `INBOX_COLUMN`; `KanbanColumn.captures: string[]` |
| `src/kanban/parser.ts` | capture accumulation in `Inbox`; strict error elsewhere; `captures` on every column |
| `src/kanban/serializer.ts` | emit capture blocks verbatim per column |
| `src/kanban/mutations.ts` | `listCaptures`, `promoteCapture`, `dropCapture`; `moveItem` rejects `Inbox` |
| `src/kanban/errors.ts` | `CaptureNotFoundError` |
| `src/kanban/io.ts` | temp-file + rename write (§5); `requireRepo` option (§9) |
| `src/commands/inboxList.ts`, `inboxPromote.ts`, `inboxDrop.ts` | new |
| `src/commands/installSkill.ts` | multi-skill install |
| `src/commands/kanbanColumns.ts` | pass `requireRepo: false` (§9) |
| `src/cli.ts` | `inbox` subcommand group; `install-skill --skill`; usage strings |
| `skill/kanban-worker/SKILL.md` | moved; parse error = stop and report; Inbox is not work |
| `skill/refining-kanban-captures/SKILL.md` | new (§7) |
| `README.md` | `## Inbox` in the board-file section; the strict-prose rule and its error; `inbox` CLI reference; known-limitations note on parse-error blocking |

Out-of-repo, same change set: `notes-kanban` skill (captures go under
`## Inbox`; boards are CLI-managed), `/mnt/tank/shared/notes/kanban/index.md`
conventions (document `## Inbox` and the strict rule, and drop the
personal-portfolio "needs migrate" caveat), and
`personal-portfolio.board.md` migrated in place (§9).

### 11. Tests

vitest (`vitest run --coverage`), alongside the existing `src/kanban/*.test.ts`
and `src/commands/*.test.ts`.

- **parser**: single bullet capture; bare-paragraph capture; multi-line block;
  several blocks split on blank lines; leading `- ` preserved verbatim; a board
  with no `## Inbox` still parses; `captures` empty on every non-Inbox column;
  item bodies unaffected. Error cases, each asserting the line number and the
  `## Inbox` remedy in the message: prose in `Backlog`, prose after an item's
  `---`, prose before the first column.
- **serializer**: round-trip of each capture shape byte-for-byte; two-round
  stability; a column with both captures and items; empty `Inbox` emits just the
  heading.
- **mutations**: `listCaptures` 1-based indexing and order; `promoteCapture`
  removes exactly one capture and appends a zeroed-retry item to the target
  column; promote with a duplicate id rejected before mutation; `dropCapture`
  removes one and leaves the rest; out-of-range and no-Inbox errors;
  `moveItem` into `Inbox` rejected.
- **io**: write leaves no temp file behind; a board file the user cannot open
  for writing but whose directory is writable is still updated (the root-owned
  case from §5); `requireRepo: true` (default) still throws
  `RepoResolutionError` for an unresolvable project; `requireRepo: false`
  returns the board with `item.repo === ''` on every item instead of throwing
  (the personal-portfolio case from §9).
- **commands**: `inbox promote` argument validation (`--body` and `--body-file`
  mutually exclusive, missing `--id`/`--title`); JSON output shape per command.
- **installSkill**: installs both skills; `--skill <name>` installs one;
  existing skill reported as skipped while a new one installs.

## Release

One `feat!` commit with a `BREAKING CHANGE:` footer — a board that parsed
before, by silently discarding prose, now throws. Semantic-release takes
`@imapps/kanban-cli` to a major version. No current board breaks (§2), but the
changelog must record that parsing became stricter, since that is exactly the
kind of behaviour change a future reader will need explained.

## Risks

- **A stray line bricks the board for every command, including read-only ones,
  and halts unattended runs.** Accepted by explicit decision. Mitigated by an
  error message carrying line number, text and remedy, and by `notes-kanban`
  telling the human where raw text belongs.
- **Verbatim storage invites junk accumulation** — captures never expire.
  Mitigated by `inbox drop` and by the skill reporting already-shipped captures
  rather than silently promoting them.
- **`captures` becoming non-optional touches every `KanbanColumn` construction
  site**, including test fixtures. Intentional: the compiler enumerates the
  sites rather than leaving `undefined` to be handled at read time.
- **Two homes for each skill** (package `skill/`, dotfiles copy) can drift. They
  are byte-identical today; both are updated in this change. A checked-in drift
  test is not worth it for two files.
- **`promote` is one read-modify-write, not concurrency-safe.** Unchanged from
  every existing mutating command; the temp-file rename in §5 prevents a torn
  file but not a lost concurrent phone edit.
