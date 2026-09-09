# Kanban CLI — human-editable Markdown board format

**Status:** approved design, pre-implementation
**Date:** 2026-09-09
**Package:** `@imapps/kanban-cli`

## Problem

The worker board file (`packages/kanban-cli`, parsed by `src/kanban/parser.ts`)
is Markdown, but every item carries its structured state in a fenced
` ```yaml ` block:

```markdown
### Add dark mode toggle

​```yaml
id: shoppingo-042
repo: /home/igor/dev/shoppingo
tags: [ui, frontend]
retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 }
​```

body...
```

Two things are wrong for how the board is actually used:

1. **The board is kept in a Syncthing folder** (`/mnt/tank/shared/notes/kanban/`)
   so it can be edited from mobile (Obsidian) and the desktop worker picks up
   the change. A fenced-yaml block with nested flow maps is not something you
   hand-edit on a phone.
2. **The board carries a machine-specific `repo` path per item.** The current
   `shoppingo.board.md` already contains two different absolute paths
   (`/home/igors/imapps/shoppingo` and
   `/home/home/imapps/shoppingo/.claude/worktrees/kanban-worker`) because
   different machines wrote different items. That path is meaningless on the
   phone and wrong on whichever desktop did not write it.

## Goal

- Item metadata expressed as a plain Markdown bullet list, no code fences.
- The synced board file contains nothing machine-specific. Each desktop
  resolves its own checkout path from the project name.
- The existing `shoppingo.board.md` is migrated; the shipped parser reads the
  old format during a transition window so nothing breaks on upgrade.
- No change to the `kanban-worker` skill's orchestration or to any CLI
  command's JSON output.

## Non-goals

- Consuming the human project notes (`shoppingo.md`, `jewellery-catalogue.md`,
  …) directly. Those stay separate, hand-maintained Obsidian notes. The worker
  board remains a dedicated `<project>.board.md` file per project.
- Changing the required columns. `Backlog` / `In Progress` / `Blocked` /
  `Done` stay required, extra columns still allowed.
- Auto-scaffolding `.board.md` files for the other projects, or porting their
  open `- [ ]` items onto a board. Possible follow-up, out of scope here.

## Design

### 1. File format

```markdown
---
project: shoppingo
---

# Shoppingo Kanban Worker Board

## Backlog

### Add dark mode toggle to settings page

- **id:** shoppingo-dark-mode
- **tags:** ui, frontend
- **branch:** feat/dark-mode
- **pr:** 142
- **retries:** implement 0, e2e_local 1, ci 0, deploy 0, e2e_live 0

Add a dark/light theme toggle to Settings, persisted in localStorage.

**Acceptance criteria**
- Toggle appears in Settings > Appearance
- Theme persists across reloads

---

## In Progress
## Blocked
## Done
```

**Frontmatter.** A leading `---` … `---` YAML block. One required key:
`project` (non-empty string). This is the only file-level metadata.

**Item metadata bullets.** Directly under the `###` heading, a contiguous run
of `- **<key>:** <value>` lines. Recognised keys:

| key | type | rendered |
| --- | --- | --- |
| `id` | string, unique across the file | always |
| `tags` | comma-separated strings | when non-empty |
| `branch` | string | when set |
| `pr` | number | when set |
| `merged_commit` | string | when set |
| `revert_pr` | number | when set |
| `retries` | `implement N, e2e_local N, ci N, deploy N, e2e_live N` | always |
| `blocked_reason` | string | when set |
| `completed_at` | ISO-8601 string | when set |

`id` and `retries` are always written (so a fresh card is self-describing and
retry state is never implied by absence). The optional fields are written only
when they hold a value — a board full of blank `- **pr:**` lines is noise, not
clarity.

**Body.** Everything after the metadata bullets, up to a lone `---` line or the
next heading — unchanged from today, including the trailing `---` visual
divider the serializer emits.

There is **no per-item `repo` field.** See section 3.

### 2. Parsing

`parseKanbanFile(markdown: string): KanbanBoard` stays pure (no filesystem
access).

1. **Frontmatter.** If the file starts with `---`, read to the closing `---`,
   parse as YAML, require `project` to be a non-empty string. Missing
   frontmatter or missing `project` → `KanbanParseError`.
2. **Headings** — `#` title, `##` columns, `###` items — unchanged.
3. **Item metadata block.** Starting at the first non-blank line after the
   `###` heading:
   - **New format:** consecutive lines matching
     `^- \*\*(?<key>[a-z_]+):\*\* ?(?<value>.*)$` where `key` is a recognised
     key. The block ends at the first line that does not match (blank line,
     prose, a body bullet, an unrecognised key). Body bullet lists such as
     `- Toggle appears in Settings` never match the `- **key:**` shape, so
     acceptance-criteria lists are never captured as metadata.
   - **Old format (transitional):** if instead the first non-blank line is a
     ` ```yaml ` fence, parse exactly as the current parser does. This lets the
     shipped build read an un-migrated board.
   - Neither present → `KanbanParseError` (`item '<title>' is missing its
     metadata block`).
4. **Field parsing.**
   - `retries`: split on `,`, each piece `<gate> <number>`; gates absent from
     the line default to `0`; unknown gates → `KanbanParseError`.
   - `tags`: split on `,`, trim, drop empties.
   - `pr` / `revert_pr`: `Number(...)`, must be a finite integer.
5. **Validation.** `id` required and unique across the file (unchanged). `repo`
   is no longer read here.

`KanbanBoard` gains `project?: string` (optional on the pure type so
heading-only fixtures stay trivial; `io.ts` enforces non-empty — see §3).

### 3. Repo resolution

New module `src/repoRegistry/resolveRepo.ts`:

```ts
resolveRepoPath(project: string): string
```

- Read `KANBAN_CLI_REPO_ROOTS` — a colon-separated list of absolute
  directories. Default: the user's home directory.
- For each root, glob up to two levels deep (`<root>/*/.kanban-cli.json` and
  `<root>/*/*/.kanban-cli.json`), read each, and return the containing directory
  whose `repoName` equals `project`.
- No match → `RepoResolutionError`:
  `no repo with repoName '<project>' found under <roots>; set KANBAN_CLI_REPO_ROOTS`.
- More than one match → `RepoResolutionError` naming the conflicting paths.

`src/kanban/io.ts` — `readKanbanBoard(path)`:

1. `parseKanbanFile(readFileSync(...))`.
2. Require `board.project` to be a non-empty string (`KanbanParseError` if
   not).
3. `const repo = resolveRepoPath(board.project)` — once per board.
4. Set `item.repo = repo` on every item before returning.

`KanbanItem.repo` stays a required `string` on the type. Every existing command
(`next`, `show`, `move`, `update`, `columns`) and every `kanban-worker` skill
step that reads `item.repo` keeps working with no change — the field is still
there in the JSON output, just resolved rather than stored.

`writeKanbanBoard` strips `repo` back out (it is never serialised).

Performance: a handful of sibling directories, one `readdir` per root plus a
few small JSON reads. No caching needed.

### 4. Serialization

`serializeKanbanBoard(board: KanbanBoard): string`:

1. Emit `---\nproject: <board.project>\n---\n\n`.
2. `# <title>`, then each column and item as today, except the item metadata is
   the bullet list from §1 instead of a ` ```yaml ` block.
3. `id` and `retries` always; other fields when set; field order matches the
   table in §1.
4. Body and trailing `---` divider handling unchanged.

Round-trips and is idempotent: `parse → serialize → parse → serialize` is
stable (existing serializer tests carry over with new fixtures).

### 5. Migration

New command `kanban-cli migrate <board> [--project <name>]`:

- Parse `<board>` (old or new format accepted).
- If the file has no `project` frontmatter and `--project` is not given →
  error.
- Write the file back in the new format.
- Idempotent: running it on an already-migrated file is a no-op-equivalent
  rewrite.

As part of this work, run it against
`/mnt/tank/shared/notes/kanban/shoppingo.board.md` with `--project shoppingo`.
That file lives on the Syncthing mount, not in this repo, so it is migrated in
place and not checked in — the README example and test fixtures are the
in-repo record of the new shape.

Transition cleanup (separate, one release later): drop the old ` ```yaml `
branch from the parser and the `migrate` command. The `yaml` dependency stays
regardless — it is still used for frontmatter.

### 6. Types and files

| File | Change |
| --- | --- |
| `src/kanban/types.ts` | `KanbanBoard.project?: string` |
| `src/kanban/parser.ts` | frontmatter parse; bullet-list metadata parse; keep old yaml-fence branch |
| `src/kanban/serializer.ts` | emit frontmatter + bullet-list metadata |
| `src/kanban/io.ts` | enforce `project`, resolve repo, populate `item.repo` |
| `src/repoRegistry/resolveRepo.ts` | new — project → checkout path |
| `src/repoRegistry/errors.ts` | new — `RepoResolutionError` |
| `src/commands/kanbanMigrate.ts` | new — `migrate` command |
| `src/cli.ts` | wire `migrate` subcommand + usage string |
| `README.md` | board-file section: frontmatter, bullet metadata, repo resolution, `KANBAN_CLI_REPO_ROOTS`, `migrate` |
| `skill/SKILL.md` | board-schema paragraph; note the board is a synced, hand-editable file |

`package.json` unchanged (`yaml` retained).

### 7. Tests

`/write-unit-test`, vitest, alongside the existing `src/kanban/*.test.ts`.

- **parser**: bullet metadata parse; old yaml-fence still parses;
  frontmatter `project` required / rejected when missing; `retries` partial
  and full parse; `tags` parse; body bullet list not captured as metadata;
  unrecognised retry gate rejected; missing-metadata-block error wording.
- **serializer**: round-trip required-only, all-fields, multi-line body;
  two-round stability; frontmatter emitted; `repo` never serialised.
- **resolveRepo**: single match; no match error text; multiple roots;
  multiple-match error; ignores `.kanban-cli.json` whose `repoName` differs.
- **io**: `readKanbanBoard` populates `item.repo` on every item; errors when
  `project` missing; errors when `project` unresolvable.
- **migrate**: old → new; idempotent on new; error when no `project` and no
  `--project`.

## Risks

- **Metadata/body ambiguity.** Mitigated by requiring the strict
  `- **key:**` shape *and* a recognised key; the block ends at the first line
  that fails either test.
- **Repo autodiscovery misses a repo** that is not one level under a
  configured root. Mitigated by the explicit `KANBAN_CLI_REPO_ROOTS` override
  and a clear error message.
- **Two machines, two `.kanban-cli.json` with the same `repoName`** under
  different roots. Treated as an error rather than picking one silently.
