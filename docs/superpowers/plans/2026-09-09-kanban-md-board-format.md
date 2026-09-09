# Kanban CLI Human-Editable Markdown Board Format — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-item fenced ` ```yaml ` metadata block in the kanban-cli board file with a hand-editable Markdown bullet list, move the machine-specific repo path out of the synced file, and migrate the one existing board.

**Architecture:** `src/kanban/parser.ts` and `serializer.ts` switch the item metadata representation from a YAML fence to `- **key:** value` bullets, and gain a YAML frontmatter block carrying `project`. A new `src/repoRegistry/` module turns that `project` name into the local checkout path by scanning for `.kanban-cli.json` files, and `src/kanban/io.ts` wires the resolution in so every command's JSON output is unchanged. The parser keeps reading the old fence format during a transition window, and a new `kanban-cli migrate` command rewrites a board in place.

**Tech Stack:** TypeScript, Bun, Vitest, Biome, the `yaml` npm package (already a dependency — retained for frontmatter and transitional fence reads).

**Spec:** `docs/superpowers/specs/2026-09-09-kanban-md-board-format-design.md`

## Global Constraints

- Package directory for every path below: `packages/kanban-cli/`. Paths in tasks are relative to it unless stated.
- Run tests with `bunx vitest run <file>` from `packages/kanban-cli/` for single-file iteration; `bun run test` runs the whole suite with coverage.
- Before every commit run `bunx biome check --write src/` from `packages/kanban-cli/` (the repo lints with Biome via the shared `@imapps/biome-config`).
- End every commit message with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec
  ```
- Required board columns stay `Backlog` / `In Progress` / `Blocked` / `Done`; extra columns still allowed. No change to the `kanban-worker` skill's step orchestration.
- `KanbanItem.repo` stays a required `string`. The pure parser sets it to `''`; `readKanbanBoard` in `io.ts` fills the real value. It is never serialized.
- Recognised item metadata keys and their rendered-when rule (from the spec):

  | key | type | rendered |
  | --- | --- | --- |
  | `id` | string, unique in file | always |
  | `retries` | `implement N, e2e_local N, ci N, deploy N, e2e_live N` | always |
  | `tags` | comma-separated strings | when non-empty |
  | `branch` | string | when set |
  | `pr` | number | when set |
  | `merged_commit` | string | when set |
  | `revert_pr` | number | when set |
  | `blocked_reason` | string | when set |
  | `completed_at` | ISO-8601 string | when set |

---

## Task 1: Item metadata as a Markdown bullet list

Switch the serializer to emit `- **key:** value` bullets and the parser to read them. The parser must *also* still read the old ` ```yaml ` fence (transitional). No frontmatter yet — that is Task 2.

**Files:**
- Modify: `src/kanban/serializer.ts`
- Modify: `src/kanban/parser.ts`
- Test: `src/kanban/serializer.test.ts`
- Test: `src/kanban/parser.test.ts`

**Interfaces:**
- Consumes: `KanbanBoard`, `KanbanItem`, `RetryCounters`, `RETRY_GATES` from `src/kanban/types.ts` (unchanged).
- Produces:
  - Serializer emits, under each `### <title>` heading, a blank line then a contiguous bullet list. `id` first, then `tags`, `branch`, `pr`, `merged_commit`, `revert_pr`, `retries`, `blocked_reason`, `completed_at` — each only when its "rendered" rule says so; `id` and `retries` always. Then a blank line, the body (if any), a blank line, `---`.
  - `retries` bullet form: `- **retries:** implement 0, e2e_local 1, ci 0, deploy 0, e2e_live 0` (all five gates, in `RETRY_GATES` order).
  - `tags` bullet form: `- **tags:** ui, frontend`.
  - Parser recognises a metadata block that is *either* the new bullet list *or* the old ` ```yaml ` fence, immediately after the `###` heading (blank lines allowed between heading and block).

- [ ] **Step 1: Write failing serializer tests for the bullet format**

Replace the body of `src/kanban/serializer.test.ts`'s existing round-trip `describe` — keep the `board()` helper and `ZERO_RETRIES`, keep every `it(...)` name, but the assertions that inspect serialized text need the new expectations. Add these explicit-output tests at the end of the `describe`:

```ts
it('serializes item metadata as a bullet list, not a yaml fence', () => {
    const b = board({
        columns: [
            {
                name: 'Backlog',
                items: [
                    {
                        id: 'a-1',
                        title: 'Add dark mode',
                        column: 'Backlog',
                        repo: '',
                        body: 'Body text.',
                        retries: { implement: 0, e2e_local: 1, ci: 0, deploy: 0, e2e_live: 0 },
                        tags: ['ui', 'frontend'],
                        branch: 'feat/dark-mode',
                        pr: 142,
                    },
                ],
            },
            { name: 'In Progress', items: [] },
            { name: 'Blocked', items: [] },
            { name: 'Done', items: [] },
        ],
    });

    const text = serializeKanbanBoard(b);

    expect(text).not.toContain('```yaml');
    expect(text).toContain('### Add dark mode\n\n- **id:** a-1\n');
    expect(text).toContain('- **tags:** ui, frontend\n');
    expect(text).toContain('- **branch:** feat/dark-mode\n');
    expect(text).toContain('- **pr:** 142\n');
    expect(text).toContain('- **retries:** implement 0, e2e_local 1, ci 0, deploy 0, e2e_live 0\n');
});

it('omits optional metadata bullets that have no value but always writes id and retries', () => {
    const b = board({
        columns: [
            {
                name: 'Backlog',
                items: [
                    {
                        id: 'a-2',
                        title: 'Minimal',
                        column: 'Backlog',
                        repo: '',
                        body: 'Body.',
                        retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
                    },
                ],
            },
            { name: 'In Progress', items: [] },
            { name: 'Blocked', items: [] },
            { name: 'Done', items: [] },
        ],
    });

    const text = serializeKanbanBoard(b);

    expect(text).toContain('- **id:** a-2\n');
    expect(text).toContain('- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0\n');
    expect(text).not.toContain('**tags:**');
    expect(text).not.toContain('**branch:**');
    expect(text).not.toContain('**pr:**');
});
```

Also update the existing round-trip `it(...)` fixtures in this file: every item literal currently has `repo: '/tmp/repo'` / `repo: '/home/igor/dev/...'` — change each to `repo: ''` (the parser no longer round-trips repo; see Global Constraints). Leave everything else in those fixtures as-is.

- [ ] **Step 2: Run serializer tests, verify they fail**

Run: `bunx vitest run src/kanban/serializer.test.ts`
Expected: FAIL — output still contains ` ```yaml `, new `toContain` assertions fail.

- [ ] **Step 3: Rewrite `serializeMeta` in `src/kanban/serializer.ts` to emit bullets**

Replace the whole file with:

```ts
import type { KanbanBoard, KanbanItem } from './types';
import { RETRY_GATES } from './types';

export function serializeKanbanBoard(board: KanbanBoard): string {
    const lines: string[] = [`# ${board.title}`, ''];

    for (const column of board.columns) {
        lines.push(`## ${column.name}`, '');

        for (const item of column.items) {
            lines.push(`### ${item.title}`, '', ...serializeMeta(item), '');

            if (item.body) {
                lines.push(item.body, '');
            }

            lines.push('---', '');
        }
    }

    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines[lines.length - 1] === '---') lines.pop();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    return `${lines.join('\n')}\n`;
}

function serializeMeta(item: KanbanItem): string[] {
    const bullets: string[] = [`- **id:** ${item.id}`];

    if (item.tags?.length) bullets.push(`- **tags:** ${item.tags.join(', ')}`);
    if (item.branch) bullets.push(`- **branch:** ${item.branch}`);
    if (item.pr !== undefined) bullets.push(`- **pr:** ${item.pr}`);
    if (item.mergedCommit) bullets.push(`- **merged_commit:** ${item.mergedCommit}`);
    if (item.revertPr !== undefined) bullets.push(`- **revert_pr:** ${item.revertPr}`);

    const retries = RETRY_GATES.map((gate) => `${gate} ${item.retries[gate]}`).join(', ');
    bullets.push(`- **retries:** ${retries}`);

    if (item.blockedReason) bullets.push(`- **blocked_reason:** ${item.blockedReason}`);
    if (item.completedAt) bullets.push(`- **completed_at:** ${item.completedAt}`);

    return bullets;
}
```

- [ ] **Step 4: Write failing parser tests for the bullet format**

In `src/kanban/parser.test.ts`, add a second fixture and tests. Keep the existing `FIXTURE` and its tests for now (they cover the transitional yaml path and must keep passing). Add:

```ts
const BULLET_FIXTURE = `# Kanban Board

## Backlog

### Add dark mode toggle

- **id:** shoppingo-042
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
`;

describe('parseKanbanFile — bullet metadata', () => {
    it('parses id, tags, branch, pr from bullets', () => {
        const [item] = parseKanbanFile(BULLET_FIXTURE).columns[0].items;
        expect(item.id).toBe('shoppingo-042');
        expect(item.tags).toEqual(['ui', 'frontend']);
        expect(item.branch).toBe('feat/dark-mode');
        expect(item.pr).toBe(142);
    });

    it('parses the retries bullet into all five gates', () => {
        const [item] = parseKanbanFile(BULLET_FIXTURE).columns[0].items;
        expect(item.retries).toEqual({ implement: 0, e2e_local: 1, ci: 0, deploy: 0, e2e_live: 0 });
    });

    it('does not swallow body bullet lists as metadata', () => {
        const [item] = parseKanbanFile(BULLET_FIXTURE).columns[0].items;
        expect(item.body).toContain('- Toggle appears in Settings > Appearance');
        expect(item.body.startsWith('Add a dark/light')).toBe(true);
    });

    it('defaults missing retry gates to zero', () => {
        const board = parseKanbanFile(`# B

## Backlog

### Partial retries

- **id:** p-1
- **retries:** ci 2

Body.
`);
        expect(board.columns[0].items[0].retries).toEqual({
            implement: 0,
            e2e_local: 0,
            ci: 2,
            deploy: 0,
            e2e_live: 0,
        });
    });

    it('throws on an unknown retry gate', () => {
        expect(() =>
            parseKanbanFile(`# B

## Backlog

### Bad gate

- **id:** b-1
- **retries:** frobnicate 1

Body.
`)
        ).toThrow(KanbanParseError);
    });

    it('throws when an item has neither a bullet block nor a yaml block', () => {
        expect(() =>
            parseKanbanFile(`# B

## Backlog

### No metadata

Just a body.
`)
        ).toThrow(/missing its metadata block/);
    });
});
```

- [ ] **Step 5: Run parser tests, verify the new ones fail**

Run: `bunx vitest run src/kanban/parser.test.ts`
Expected: FAIL on the `bullet metadata` describe (bullets parsed as body; `retries` undefined-shaped). The old `FIXTURE` tests still pass.

- [ ] **Step 6: Rewrite `parseItem` in `src/kanban/parser.ts` to read bullets or the yaml fence**

Replace the file with:

```ts
import { parse as parseYamlDocument } from 'yaml';
import { KanbanParseError } from './errors';
import type { KanbanBoard, KanbanColumn, KanbanItem, RetryCounters, RetryGate } from './types';
import { RETRY_GATES } from './types';

const TITLE_HEADING = /^#\s+(.+?)\s*$/;
const COLUMN_HEADING = /^##\s+(.+?)\s*$/;
const ITEM_HEADING = /^###\s+(.+?)\s*$/;
const YAML_FENCE_START = /^```ya?ml\s*$/;
const YAML_FENCE_END = /^```\s*$/;
const META_BULLET = /^-\s+\*\*([a-z_]+):\*\*\s?(.*)$/;

const KNOWN_KEYS = new Set([
    'id',
    'repo',
    'tags',
    'branch',
    'pr',
    'merged_commit',
    'revert_pr',
    'retries',
    'blocked_reason',
    'completed_at',
]);

const DEFAULT_RETRIES: RetryCounters = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

/**
 * A lone `---` line always terminates an item's body, in addition to the next
 * heading. This is what lets the serializer emit a visual divider after every
 * item without that divider being re-captured as body text on the next parse.
 */
const BODY_SEPARATOR = /^---\s*$/;

export function parseKanbanFile(markdown: string): KanbanBoard {
    const lines = markdown.split(/\r?\n/);

    let title = 'Kanban Board';
    const columns: KanbanColumn[] = [];
    const seenIds = new Set<string>();

    let currentColumn: KanbanColumn | null = null;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        const titleMatch = line.match(TITLE_HEADING);
        if (titleMatch && columns.length === 0 && !currentColumn) {
            title = titleMatch[1];
            i += 1;
            continue;
        }

        const columnMatch = line.match(COLUMN_HEADING);
        if (columnMatch) {
            currentColumn = { name: columnMatch[1], items: [] };
            columns.push(currentColumn);
            i += 1;
            continue;
        }

        const itemMatch = line.match(ITEM_HEADING);
        if (itemMatch) {
            if (!currentColumn) {
                throw new KanbanParseError(`Item heading '${itemMatch[1]}' appears before any column (##) heading`);
            }

            const parsed = parseItem(lines, i + 1, itemMatch[1]);

            if (seenIds.has(parsed.item.id)) {
                throw new KanbanParseError(`Duplicate item id '${parsed.item.id}'`);
            }
            seenIds.add(parsed.item.id);

            currentColumn.items.push({ ...parsed.item, column: currentColumn.name });
            i = parsed.nextIndex;
            continue;
        }

        i += 1;
    }

    return { title, columns };
}

function parseItem(lines: string[], start: number, itemTitle: string): { item: KanbanItem; nextIndex: number } {
    let i = start;
    while (i < lines.length && lines[i].trim() === '') i += 1;

    let meta: Record<string, unknown>;
    if (i < lines.length && YAML_FENCE_START.test(lines[i])) {
        ({ meta, nextIndex: i } = parseYamlMeta(lines, i, itemTitle));
    } else if (i < lines.length && META_BULLET.test(lines[i]) && KNOWN_KEYS.has(lines[i].match(META_BULLET)?.[1] ?? '')) {
        ({ meta, nextIndex: i } = parseBulletMeta(lines, i));
    } else {
        throw new KanbanParseError(`Item '${itemTitle}' is missing its metadata block`);
    }

    if (typeof meta.id !== 'string' || meta.id.trim() === '') {
        throw new KanbanParseError(`Item '${itemTitle}' is missing a required 'id' field`);
    }

    const bodyLines: string[] = [];
    while (
        i < lines.length &&
        !COLUMN_HEADING.test(lines[i]) &&
        !ITEM_HEADING.test(lines[i]) &&
        !BODY_SEPARATOR.test(lines[i])
    ) {
        bodyLines.push(lines[i]);
        i += 1;
    }
    if (i < lines.length && BODY_SEPARATOR.test(lines[i])) {
        i += 1;
    }

    const item: KanbanItem = {
        id: meta.id,
        title: itemTitle,
        column: '',
        repo: typeof meta.repo === 'string' ? meta.repo : '',
        body: trimBlankEdges(bodyLines),
        retries: coerceRetries(meta.retries),
        tags: coerceTags(meta.tags),
        branch: typeof meta.branch === 'string' ? meta.branch : undefined,
        pr: coerceNumber(meta.pr),
        mergedCommit: typeof meta.merged_commit === 'string' ? meta.merged_commit : undefined,
        revertPr: coerceNumber(meta.revert_pr),
        blockedReason: typeof meta.blocked_reason === 'string' ? meta.blocked_reason : undefined,
        completedAt: typeof meta.completed_at === 'string' ? meta.completed_at : undefined,
    };

    return { item, nextIndex: i };
}

function parseYamlMeta(
    lines: string[],
    fenceStart: number,
    itemTitle: string
): { meta: Record<string, unknown>; nextIndex: number } {
    let i = fenceStart + 1;
    const yamlLines: string[] = [];
    while (i < lines.length && !YAML_FENCE_END.test(lines[i])) {
        yamlLines.push(lines[i]);
        i += 1;
    }
    if (i >= lines.length) {
        throw new KanbanParseError(`Item '${itemTitle}' has an unterminated yaml metadata block`);
    }
    i += 1;

    try {
        return { meta: (parseYamlDocument(yamlLines.join('\n')) ?? {}) as Record<string, unknown>, nextIndex: i };
    } catch (cause) {
        throw new KanbanParseError(`Item '${itemTitle}' has invalid yaml metadata: ${(cause as Error).message}`);
    }
}

function parseBulletMeta(lines: string[], start: number): { meta: Record<string, unknown>; nextIndex: number } {
    const meta: Record<string, unknown> = {};
    let i = start;
    while (i < lines.length) {
        const match = lines[i].match(META_BULLET);
        if (!match || !KNOWN_KEYS.has(match[1])) break;
        meta[match[1]] = match[2].trim();
        i += 1;
    }
    return { meta, nextIndex: i };
}

function coerceRetries(raw: unknown): RetryCounters {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return { ...DEFAULT_RETRIES, ...(raw as Partial<RetryCounters>) };
    }
    if (typeof raw !== 'string' || raw.trim() === '') return { ...DEFAULT_RETRIES };

    const counters: RetryCounters = { ...DEFAULT_RETRIES };
    for (const pair of raw.split(',')) {
        const [gate, value] = pair.trim().split(/\s+/);
        if (!RETRY_GATES.includes(gate as RetryGate)) {
            throw new KanbanParseError(`Unknown retry gate '${gate}' in retries metadata`);
        }
        counters[gate as RetryGate] = Number(value) || 0;
    }
    return counters;
}

function coerceTags(raw: unknown): string[] | undefined {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string' && raw.trim() !== '') {
        return raw
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    }
    return undefined;
}

function coerceNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
    return undefined;
}

function trimBlankEdges(lines: string[]): string {
    const trimmed = [...lines];
    while (trimmed.length && trimmed[0].trim() === '') trimmed.shift();
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
    return trimmed.join('\n');
}
```

Note: the old `FIXTURE` test `'throws on missing repo'` in `parser.test.ts` will now fail (repo is no longer required). Delete that single `it('throws on missing repo', ...)` block. Keep `'throws on missing id'`. Update the `'throws on a missing yaml metadata block'` test's matcher from `/missing its yaml metadata block/` to `/missing its metadata block/`.

- [ ] **Step 7: Run the full kanban suite, verify green**

Run: `bunx vitest run src/kanban/`
Expected: PASS. If a round-trip test fails on `repo`, confirm its fixture item literals were changed to `repo: ''` in Step 1.

- [ ] **Step 8: Lint and commit**

```bash
bunx biome check --write src/
git add src/kanban/
git commit -m "feat(kanban-cli): item metadata as markdown bullet list

Serializer emits '- **key:** value' bullets instead of a fenced yaml block.
Parser reads the bullet list, and still reads the old yaml fence for a
transition window. repo is no longer read from or written to the item.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec"
```

---

## Task 2: Board frontmatter carrying `project`

Add a leading YAML frontmatter block to the board file with a required `project` key.

**Files:**
- Modify: `src/kanban/types.ts`
- Modify: `src/kanban/parser.ts`
- Modify: `src/kanban/serializer.ts`
- Test: `src/kanban/parser.test.ts`
- Test: `src/kanban/serializer.test.ts`

**Interfaces:**
- Consumes: `parseKanbanFile`, `serializeKanbanBoard` from Task 1.
- Produces:
  - `KanbanBoard` gains `project?: string`.
  - `parseKanbanFile` reads a leading `---` … `---` block as YAML and sets `board.project` from its `project` key. If the block is present but has no non-empty `project`, throws `KanbanParseError`. No leading block → `board.project` is `undefined` (pure parser stays lenient; `io.ts` enforces in Task 4).
  - `serializeKanbanBoard` throws `Error` if `board.project` is missing/empty, otherwise emits `---\nproject: <project>\n---\n\n` before the `#` title.

- [ ] **Step 1: Add `project` to the board type**

In `src/kanban/types.ts`, change the `KanbanBoard` interface:

```ts
export interface KanbanBoard {
    title: string;
    project?: string;
    columns: KanbanColumn[];
}
```

- [ ] **Step 2: Write failing frontmatter tests**

In `src/kanban/serializer.test.ts`, update the `board()` helper to include a project, and add explicit tests:

```ts
function board(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
    return {
        title: 'Kanban Board',
        project: 'shoppingo',
        columns: [
            { name: 'Backlog', items: [] },
            { name: 'In Progress', items: [] },
            { name: 'Blocked', items: [] },
            { name: 'Done', items: [] },
        ],
        ...overrides,
    };
}
```

```ts
it('emits project frontmatter ahead of the title', () => {
    expect(serializeKanbanBoard(board())).toMatch(/^---\nproject: shoppingo\n---\n\n# Kanban Board\n/);
});

it('throws when the board has no project', () => {
    expect(() => serializeKanbanBoard({ ...board(), project: undefined })).toThrow(/project/);
});
```

In `src/kanban/parser.test.ts` add:

```ts
describe('parseKanbanFile — frontmatter', () => {
    it('reads project from leading frontmatter', () => {
        const board = parseKanbanFile(`---
project: shoppingo
---

# Board

## Backlog
## In Progress
## Blocked
## Done
`);
        expect(board.project).toBe('shoppingo');
    });

    it('throws when frontmatter is present without a project', () => {
        expect(() =>
            parseKanbanFile(`---
updated: 2026-09-09
---

# Board

## Backlog
`)
        ).toThrow(KanbanParseError);
    });

    it('leaves project undefined when there is no frontmatter', () => {
        expect(parseKanbanFile(BULLET_FIXTURE).project).toBeUndefined();
    });
});
```

- [ ] **Step 3: Run tests, verify failure**

Run: `bunx vitest run src/kanban/`
Expected: FAIL — `project` undefined in output, no frontmatter emitted, parser ignores frontmatter.

- [ ] **Step 4: Parse frontmatter in `src/kanban/parser.ts`**

At the top of `parseKanbanFile`, before the `while` loop, consume a leading frontmatter block:

```ts
export function parseKanbanFile(markdown: string): KanbanBoard {
    const lines = markdown.split(/\r?\n/);

    let title = 'Kanban Board';
    let project: string | undefined;
    const columns: KanbanColumn[] = [];
    const seenIds = new Set<string>();

    let currentColumn: KanbanColumn | null = null;
    let i = 0;

    if (lines[0]?.trim() === '---') {
        let end = 1;
        while (end < lines.length && lines[end].trim() !== '---') end += 1;
        if (end >= lines.length) {
            throw new KanbanParseError('Board frontmatter is not terminated by a closing ---');
        }
        let front: Record<string, unknown>;
        try {
            front = (parseYamlDocument(lines.slice(1, end).join('\n')) ?? {}) as Record<string, unknown>;
        } catch (cause) {
            throw new KanbanParseError(`Board frontmatter is not valid yaml: ${(cause as Error).message}`);
        }
        if (typeof front.project !== 'string' || front.project.trim() === '') {
            throw new KanbanParseError("Board frontmatter is missing a required 'project' field");
        }
        project = front.project;
        i = end + 1;
    }
```

Then change the final `return` to `return { title, project, columns };`.

- [ ] **Step 5: Emit frontmatter in `src/kanban/serializer.ts`**

At the start of `serializeKanbanBoard`:

```ts
export function serializeKanbanBoard(board: KanbanBoard): string {
    if (!board.project || board.project.trim() === '') {
        throw new Error('Cannot serialize a board without a project');
    }

    const lines: string[] = ['---', `project: ${board.project}`, '---', '', `# ${board.title}`, ''];
    // ... rest unchanged
```

- [ ] **Step 6: Fix the Task 1 parser fixtures that now lack frontmatter**

The `FIXTURE` and `BULLET_FIXTURE` constants and inline-string boards in `parser.test.ts` have no frontmatter — that is fine, the pure parser allows it (they assert `project` is `undefined` or don't check it). No change needed unless a round-trip test in `serializer.test.ts` fails: those go through `board()` which now has `project`, so they round-trip `project: 'shoppingo'`. Confirm the round-trip `toEqual(b)` assertions still hold (the parsed board will have `project: 'shoppingo'`, matching `b`).

- [ ] **Step 7: Run the suite**

Run: `bunx vitest run src/kanban/`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
bunx biome check --write src/
git add src/kanban/
git commit -m "feat(kanban-cli): board project frontmatter

Board file carries a leading '---\nproject: <name>\n---' block. The pure
parser reads it; serialization requires it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec"
```

---

## Task 3: `resolveRepoPath` — project name to local checkout

New module that scans for `.kanban-cli.json` files and returns the directory whose `repoName` matches a given project.

**Files:**
- Create: `src/repoRegistry/errors.ts`
- Create: `src/repoRegistry/resolveRepo.ts`
- Test: `src/repoRegistry/resolveRepo.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. `CONFIG_FILENAME` (`'.kanban-cli.json'`) from `src/repoConfig/types.ts`.
- Produces:
  - `class RepoResolutionError extends Error` in `src/repoRegistry/errors.ts` (`name = 'RepoResolutionError'`).
  - `const REPO_ROOTS_ENV = 'KANBAN_CLI_REPO_ROOTS'` in `src/repoRegistry/resolveRepo.ts`.
  - `function repoRoots(env?: NodeJS.ProcessEnv): string[]` — parses the colon-separated env var; default `[os.homedir()]`.
  - `function resolveRepoPath(project: string, roots?: string[]): string` — returns the absolute path of the matching repo, or throws `RepoResolutionError` (no match, or more than one match).

- [ ] **Step 1: Write `src/repoRegistry/errors.ts`**

```ts
export class RepoResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepoResolutionError';
    }
}
```

- [ ] **Step 2: Write the failing test `src/repoRegistry/resolveRepo.test.ts`**

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoResolutionError } from './errors';
import { repoRoots, resolveRepoPath } from './resolveRepo';

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kanban-cli-registry-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function makeRepo(dir: string, repoName: string) {
    const path = join(root, dir);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, '.kanban-cli.json'), JSON.stringify({ repoName }));
    return path;
}

describe('repoRoots', () => {
    it('splits the env var on colons', () => {
        expect(repoRoots({ KANBAN_CLI_REPO_ROOTS: '/a:/b:/c' })).toEqual(['/a', '/b', '/c']);
    });

    it('falls back to the home directory when unset', () => {
        const roots = repoRoots({});
        expect(roots).toHaveLength(1);
        expect(roots[0]).toBeTruthy();
    });
});

describe('resolveRepoPath', () => {
    it('returns the directory whose .kanban-cli.json repoName matches', () => {
        const expected = makeRepo('shoppingo', 'shoppingo');
        makeRepo('kivo', 'kivo');
        expect(resolveRepoPath('shoppingo', [root])).toBe(expected);
    });

    it('ignores repos whose repoName does not match', () => {
        makeRepo('other', 'not-it');
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(RepoResolutionError);
    });

    it('names the project and roots in the no-match error', () => {
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(/shoppingo/);
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(new RegExp(root.replace(/[/\\]/g, '\\$&')));
    });

    it('throws when more than one repo claims the project', () => {
        makeRepo('a', 'shoppingo');
        makeRepo('b', 'shoppingo');
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(/more than one/i);
    });

    it('skips roots that do not exist', () => {
        const expected = makeRepo('shoppingo', 'shoppingo');
        expect(resolveRepoPath('shoppingo', [join(root, 'nope'), root])).toBe(expected);
    });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `bunx vitest run src/repoRegistry/resolveRepo.test.ts`
Expected: FAIL — module `./resolveRepo` not found.

- [ ] **Step 4: Write `src/repoRegistry/resolveRepo.ts`**

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILENAME } from '../repoConfig/types';
import { RepoResolutionError } from './errors';

export const REPO_ROOTS_ENV = 'KANBAN_CLI_REPO_ROOTS';

export function repoRoots(env: NodeJS.ProcessEnv = process.env): string[] {
    const raw = env[REPO_ROOTS_ENV];
    if (!raw || raw.trim() === '') return [homedir()];
    return raw
        .split(':')
        .map((r) => r.trim())
        .filter(Boolean);
}

export function resolveRepoPath(project: string, roots: string[] = repoRoots()): string {
    const matches: string[] = [];

    for (const root of roots) {
        let entries: string[];
        try {
            entries = readdirSync(root, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name);
        } catch {
            continue;
        }

        for (const name of entries) {
            const dir = join(root, name);
            const configPath = join(dir, CONFIG_FILENAME);
            if (!existsSync(configPath)) continue;
            try {
                const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { repoName?: unknown };
                if (parsed.repoName === project) matches.push(dir);
            } catch {
                // a malformed .kanban-cli.json elsewhere must not break resolution
            }
        }
    }

    if (matches.length === 0) {
        throw new RepoResolutionError(
            `No repo with repoName '${project}' found under ${roots.join(', ')}; set ${REPO_ROOTS_ENV} to the directory that contains your checkouts`
        );
    }
    if (matches.length > 1) {
        throw new RepoResolutionError(
            `Found more than one repo with repoName '${project}': ${matches.join(', ')}`
        );
    }
    return matches[0];
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `bunx vitest run src/repoRegistry/resolveRepo.test.ts`
Expected: PASS.

- [ ] **Step 6: Export from `src/index.ts`**

Add, in alphabetical position (after the `./process/*` block, before `./repoConfig/*`... actually `repoRegistry` sorts after `repoConfig`; place after the three `./repoConfig/*` lines):

```ts
export * from './repoRegistry/errors';
export * from './repoRegistry/resolveRepo';
```

- [ ] **Step 7: Lint and commit**

```bash
bunx biome check --write src/
git add src/repoRegistry/ src/index.ts
git commit -m "feat(kanban-cli): resolve repo checkout path from project name

New repoRegistry module scans KANBAN_CLI_REPO_ROOTS (default: home dir) for
.kanban-cli.json files and returns the directory whose repoName matches.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec"
```

---

## Task 4: Wire repo resolution into `io.ts`

`readKanbanBoard` now enforces `project` and fills `item.repo` for every item.

**Files:**
- Modify: `src/kanban/io.ts`
- Test: `src/kanban/io.test.ts` (create)

**Interfaces:**
- Consumes: `parseKanbanFile` (sets `board.project`), `serializeKanbanBoard` from Tasks 1–2; `resolveRepoPath` from Task 3; `KanbanParseError` from `src/kanban/errors.ts`.
- Produces:
  - `readKanbanBoard(path: string): KanbanBoard` — throws `KanbanParseError` if the parsed board has no `project`; otherwise calls `resolveRepoPath(board.project)` once and returns the board with `item.repo` set on every item in every column.
  - `writeKanbanBoard(path: string, board: KanbanBoard): void` — unchanged signature; `serializeKanbanBoard` already ignores `repo`.

- [ ] **Step 1: Write the failing test `src/kanban/io.test.ts`**

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KanbanParseError } from './errors';
import { readKanbanBoard } from './io';

let root: string;
let boardPath: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kanban-cli-io-'));
    const repoDir = join(root, 'shoppingo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, '.kanban-cli.json'), JSON.stringify({ repoName: 'shoppingo' }));
    process.env.KANBAN_CLI_REPO_ROOTS = root;

    boardPath = join(root, 'shoppingo.board.md');
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.env.KANBAN_CLI_REPO_ROOTS = undefined;
});

const BOARD = `---
project: shoppingo
---

# Shoppingo Board

## Backlog

### First item

- **id:** shoppingo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body.

---

## In Progress
## Blocked
## Done
`;

describe('readKanbanBoard', () => {
    it('fills item.repo from the resolved project path', () => {
        writeFileSync(boardPath, BOARD);
        const board = readKanbanBoard(boardPath);
        expect(board.columns[0].items[0].repo).toBe(join(root, 'shoppingo'));
    });

    it('throws when the board has no project frontmatter', () => {
        writeFileSync(boardPath, BOARD.replace('---\nproject: shoppingo\n---\n\n', ''));
        expect(() => readKanbanBoard(boardPath)).toThrow(KanbanParseError);
    });

    it('propagates a resolution failure when the project is unknown', () => {
        writeFileSync(boardPath, BOARD.replace('project: shoppingo', 'project: nonexistent'));
        expect(() => readKanbanBoard(boardPath)).toThrow(/nonexistent/);
    });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `bunx vitest run src/kanban/io.test.ts`
Expected: FAIL — `repo` is `''`, no `project` guard.

- [ ] **Step 3: Rewrite `src/kanban/io.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveRepoPath } from '../repoRegistry/resolveRepo';
import { KanbanParseError } from './errors';
import { parseKanbanFile } from './parser';
import { serializeKanbanBoard } from './serializer';
import type { KanbanBoard } from './types';

export function readKanbanBoard(path: string): KanbanBoard {
    const board = parseKanbanFile(readFileSync(path, 'utf8'));

    if (!board.project || board.project.trim() === '') {
        throw new KanbanParseError(
            "Board file is missing its 'project' frontmatter (--- project: <name> ---)"
        );
    }

    const repo = resolveRepoPath(board.project);

    return {
        ...board,
        columns: board.columns.map((column) => ({
            ...column,
            items: column.items.map((item) => ({ ...item, repo })),
        })),
    };
}

export function writeKanbanBoard(path: string, board: KanbanBoard): void {
    writeFileSync(path, serializeKanbanBoard(board));
}
```

- [ ] **Step 4: Run the io test, then the full suite**

Run: `bunx vitest run src/kanban/io.test.ts`
Expected: PASS.

Run: `bun run test`
Expected: PASS. Existing command tests (`recordUsage`, `usageCheck`, `pollForCondition`, `healthCheck`) are unaffected. If any command test reads a board fixture from disk, it needs the frontmatter + a matching `.kanban-cli.json` under `KANBAN_CLI_REPO_ROOTS` — check `src/commands/*.test.ts`; at time of writing only `recordUsage.test.ts` and `usageCheck.test.ts` exist and neither touches a board.

- [ ] **Step 5: Lint and commit**

```bash
bunx biome check --write src/
git add src/kanban/io.ts src/kanban/io.test.ts
git commit -m "feat(kanban-cli): resolve item.repo when reading the board

readKanbanBoard requires project frontmatter and fills every item's repo
from the resolved checkout path. Command JSON output is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec"
```

---

## Task 5: `kanban-cli migrate` command

Rewrites a board file in place from the old format (or new) to the new format, injecting `project` if the file lacks frontmatter.

**Files:**
- Create: `src/commands/kanbanMigrate.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/kanbanMigrate.test.ts` (create)
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `parseKanbanFile`, `serializeKanbanBoard` from Tasks 1–2.
- Produces:
  - `function kanbanMigrate(boardPath: string, opts: { project?: string }): { ok: true; project: string; path: string }` in `src/commands/kanbanMigrate.ts`. Reads the file with `parseKanbanFile` (pure — no repo resolution), applies `opts.project` when the parsed board has none, throws `Error('a project name is required: pass --project <name>')` if neither is present, writes `serializeKanbanBoard` back to `boardPath`.
  - CLI: `kanban-cli migrate <board> [--project <name>]`.

- [ ] **Step 1: Write the failing test `src/commands/kanbanMigrate.test.ts`**

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kanbanMigrate } from './kanbanMigrate';

let dir: string;
let boardPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanban-cli-migrate-'));
    boardPath = join(dir, 'board.md');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const OLD_FORMAT = `# Shoppingo Board

## Backlog

### Add dark mode

\`\`\`yaml
id: shoppingo-042
repo: /home/igor/dev/shoppingo
tags:
  - ui
retries:
  implement: 0
  e2e_local: 1
  ci: 0
  deploy: 0
  e2e_live: 0
\`\`\`

Body text.

---

## In Progress
## Blocked
## Done
`;

describe('kanbanMigrate', () => {
    it('rewrites an old-format board to bullets with injected project frontmatter', () => {
        writeFileSync(boardPath, OLD_FORMAT);
        const result = kanbanMigrate(boardPath, { project: 'shoppingo' });

        expect(result).toEqual({ ok: true, project: 'shoppingo', path: boardPath });

        const out = readFileSync(boardPath, 'utf8');
        expect(out).toMatch(/^---\nproject: shoppingo\n---\n/);
        expect(out).not.toContain('```yaml');
        expect(out).toContain('- **id:** shoppingo-042');
        expect(out).toContain('- **tags:** ui');
        expect(out).toContain('- **retries:** implement 0, e2e_local 1, ci 0, deploy 0, e2e_live 0');
        expect(out).not.toContain('repo:');
    });

    it('is idempotent on an already-migrated board', () => {
        writeFileSync(boardPath, OLD_FORMAT);
        kanbanMigrate(boardPath, { project: 'shoppingo' });
        const once = readFileSync(boardPath, 'utf8');
        kanbanMigrate(boardPath, {});
        expect(readFileSync(boardPath, 'utf8')).toBe(once);
    });

    it('throws when the board has no project and none is passed', () => {
        writeFileSync(boardPath, OLD_FORMAT);
        expect(() => kanbanMigrate(boardPath, {})).toThrow(/project/);
    });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `bunx vitest run src/commands/kanbanMigrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/commands/kanbanMigrate.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseKanbanFile } from '../kanban/parser';
import { serializeKanbanBoard } from '../kanban/serializer';

export function kanbanMigrate(
    boardPath: string,
    opts: { project?: string }
): { ok: true; project: string; path: string } {
    const board = parseKanbanFile(readFileSync(boardPath, 'utf8'));
    const project = board.project ?? opts.project;

    if (!project || project.trim() === '') {
        throw new Error('a project name is required: pass --project <name>');
    }

    writeFileSync(boardPath, serializeKanbanBoard({ ...board, project }));
    return { ok: true as const, project, path: boardPath };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `bunx vitest run src/commands/kanbanMigrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the CLI subcommand in `src/cli.ts`**

Add the import near the other command imports:

```ts
import { kanbanMigrate } from './commands/kanbanMigrate';
```

Add a case in the `main()` switch, after the `columns` case:

```ts
        case 'migrate': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: { project: { type: 'string' } },
                allowPositionals: true,
            });
            if (!positionals[0]) throw new Error('Usage: kanban-cli migrate <board> [--project <name>]');
            printSuccess(kanbanMigrate(positionals[0], { project: values.project }));
            return;
        }
```

Update the `USAGE` string's `Commands:` line to include `migrate <board>`:

```ts
    'Commands: next, show <id>, move <id> <column>, update <id>, columns, migrate <board>,\n' +
```

- [ ] **Step 6: Export from `src/index.ts`**

Add after the other `./commands/*`… wait — `src/index.ts` does not currently export any `./commands/*`. Skip this step; commands are CLI-only. (Left here so a reader knows it was considered.)

- [ ] **Step 7: Run the full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
bunx biome check --write src/
git add src/commands/kanbanMigrate.ts src/commands/kanbanMigrate.test.ts src/cli.ts
git commit -m "feat(kanban-cli): add migrate command for the board format

kanban-cli migrate <board> [--project <name>] rewrites a board from the old
fenced-yaml format to the bullet format, injecting project frontmatter.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec"
```

---

## Task 6: Documentation

Update the README and the skill doc to describe the new format, `project`
frontmatter, repo resolution, and the `migrate` command.

**Files:**
- Modify: `README.md`
- Modify: `skill/SKILL.md`

**Interfaces:**
- Consumes: the final behaviour of Tasks 1–5. No code.

- [ ] **Step 1: Rewrite the "The board file" section of `README.md`**

Replace the section (currently lines ~26–65, from `## The board file` to the end of the paragraph before `## Per-repo config`) with:

````markdown
## The board file

A YAML frontmatter block with a required `project` key, then `##` column
headings (`Backlog`, `In Progress`, `Blocked`, `Done` required; extra columns
allowed), then `###` item headings. Each item is followed by a Markdown bullet
list of its fields, then a freeform Markdown body (description / acceptance
criteria) up to a `---` line or the next heading.

```markdown
---
project: shoppingo
---

# Shoppingo Kanban Worker Board

## Backlog

### Add dark mode toggle to settings page

- **id:** shoppingo-dark-mode
- **tags:** ui, frontend
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Add a dark/light theme toggle to Settings, persisted in localStorage.

**Acceptance criteria**
- Toggle appears in Settings > Appearance
- Theme persists across reloads

---

## In Progress
## Blocked
## Done
```

The board file is designed to be hand-editable — including from a phone (e.g.
Obsidian over a synced folder). `- **id:**` and `- **retries:**` are always
written; `- **tags:**`, `- **branch:**`, `- **pr:**`, `- **merged_commit:**`,
`- **revert_pr:**`, `- **blocked_reason:**`, `- **completed_at:**` appear only
when set. `retries` counters default to zero when a gate is omitted.

`id` must be unique across the file. There is **no `repo` field** — the board
carries only `project`, and each machine resolves its own checkout path (see
below). Prefer editing through `kanban-cli next/show/move/update` so the
round-trip and retry counters stay intact, but a careful hand-edit of the
bullet list or body is fine.

### Resolving the checkout path

`kanban-cli` turns the board's `project` into a local repo path by scanning for
`.kanban-cli.json` files: for each directory listed in `KANBAN_CLI_REPO_ROOTS`
(colon-separated; defaults to your home directory), it looks one level deep for
a `*/.kanban-cli.json` whose `repoName` equals `project`. Set
`KANBAN_CLI_REPO_ROOTS=/path/to/your/checkouts` if your repos do not live
directly under `$HOME`.

### Migrating an existing board

Older boards stored each item's fields in a fenced ` ```yaml ` block and a
per-item `repo` path. `kanban-cli` still reads that format. To convert a board
in place:

```sh
kanban-cli migrate path/to/board.md --project <name>
```

(`--project` is only needed when the file has no `project` frontmatter yet.)
````

- [ ] **Step 2: Update the CLI reference block in `README.md`**

In the `## CLI reference` fenced block, add under the `kanban-cli columns` line:

```
kanban-cli migrate <board> [--project <name>]
```

- [ ] **Step 3: Update `skill/SKILL.md`**

In the `## Board schema` section, replace the sentence beginning "`###` headings are items, each immediately followed by a fenced ` ```yaml ` block…" with:

```markdown
The file opens with a `---\nproject: <name>\n---` frontmatter block. `##`
headings are columns (`Backlog`, `In Progress`, `Blocked`, `Done` required;
extra columns are fine). `###` headings are items, each followed by a Markdown
bullet list of fields (`- **id:**`, `- **retries:**` always; `- **tags:**`,
`- **branch:**`, `- **pr:**`, `- **merged_commit:**`, `- **revert_pr:**`,
`- **blocked_reason:**`, `- **completed_at:**` when set), then freeform
Markdown body up to a `---` line or the next heading. There is no per-item
`repo` — `kanban-cli` resolves the checkout path from `project` by scanning
`KANBAN_CLI_REPO_ROOTS` (default `$HOME`) for a `*/.kanban-cli.json` whose
`repoName` matches. The board is meant to be hand-editable (e.g. from a phone
over a synced folder); still prefer `kanban-cli next/show/move/update` for
worker edits so retry counters and round-trip stay intact.
```

In the `## Locating the board file` section, after the existing paragraph, add:

```markdown
If `kanban-cli` reports a `RepoResolutionError`, the board's `project` did not
match any `.kanban-cli.json` `repoName` under `KANBAN_CLI_REPO_ROOTS` — tell
the user to set that env var to the directory holding their checkouts, or to
fix the `repoName` in the repo's `.kanban-cli.json`.
```

- [ ] **Step 4: Verify no stale `repo:` references remain**

Run: `grep -n "yaml" README.md skill/SKILL.md`
Expected: only the `migrate` / "still reads that format" mentions remain; no example still shows a ` ```yaml ` item block or a per-item `repo:` line.

- [ ] **Step 5: Commit**

```bash
git add README.md skill/SKILL.md
git commit -m "docs(kanban-cli): document the markdown board format

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CZwBGMXJkpoqBLn6MYXaec"
```

---

## Task 7: Migrate the live board file

The one existing board in this format lives on the Syncthing mount at
`/mnt/tank/shared/notes/kanban/shoppingo.board.md`. It is not in this repo.

**Files:**
- Modify (outside repo): `/mnt/tank/shared/notes/kanban/shoppingo.board.md`

**Interfaces:**
- Consumes: the built `kanban-cli` / `kanbanMigrate` from Task 5.

- [ ] **Step 1: Back up the current file**

```bash
cp /mnt/tank/shared/notes/kanban/shoppingo.board.md /tmp/shoppingo.board.md.bak
```

- [ ] **Step 2: Run the migration**

From `packages/kanban-cli/`:

```bash
bun run src/cli.ts migrate /mnt/tank/shared/notes/kanban/shoppingo.board.md --project shoppingo
```

Expected stdout: `{"ok":true,"project":"shoppingo","path":"/mnt/tank/shared/notes/kanban/shoppingo.board.md"}`

- [ ] **Step 3: Eyeball the result**

Run: `git --no-pager diff --no-index /tmp/shoppingo.board.md.bak /mnt/tank/shared/notes/kanban/shoppingo.board.md`

Confirm: frontmatter added; every `### item` now has a bullet list; no ` ```yaml ` blocks; no `repo:` lines; bodies (`Plan:` / `Acceptance criteria` / closing notes) preserved; `completed_at` / `merged_commit` / `pr` values carried over.

- [ ] **Step 4: Confirm the CLI can read it back**

Ensure a `shoppingo` repo with `.kanban-cli.json` (`repoName: shoppingo`) exists under `$HOME` or `KANBAN_CLI_REPO_ROOTS`, then:

```bash
bun run src/cli.ts columns --kanban /mnt/tank/shared/notes/kanban/shoppingo.board.md
```

Expected: `{"ok":true,"columns":["Backlog","In Progress","Blocked","Done"]}`

- [ ] **Step 5: No commit**

This file is outside the repo. Nothing to commit. Note completion in the PR description instead.

---

## Self-Review

**Spec coverage:**
- §1 File format → Tasks 1, 2 (bullets + frontmatter).
- §2 Parsing (frontmatter, bullet block, dual-read, field parsing, id unique, no repo) → Tasks 1, 2.
- §3 Repo resolution (`resolveRepo.ts`, `KANBAN_CLI_REPO_ROOTS`, io wiring, errors) → Tasks 3, 4.
- §4 Serialization → Tasks 1, 2.
- §5 Migration (`migrate` command, convert live file, `yaml` retained) → Tasks 5, 7.
- §6 Types & files → spread across all tasks; `KanbanBoard.project` in Task 2, `KanbanItem.repo` handling in Tasks 1 & 4.
- §7 Tests → each task ends with its test file; io/resolveRepo/migrate covered in Tasks 3–5.
- §7 Risks: metadata/body ambiguity → Task 1 Step 4 test `does not swallow body bullet lists`; multi-match → Task 3 test.

**Placeholder scan:** Task 5 Step 6 is intentionally a no-op with an explanation (not a placeholder). No TBDs, no "add error handling", all code blocks concrete.

**Type consistency:** `resolveRepoPath(project, roots?)`, `repoRoots(env?)`, `REPO_ROOTS_ENV`, `RepoResolutionError`, `kanbanMigrate(boardPath, { project? })`, `KanbanBoard.project?: string`, `serializeMeta` returns `string[]` — consistent across Tasks 3, 4, 5. `KanbanItem.repo` stays required `string`, set to `''` by the pure parser and filled by `readKanbanBoard` — stated in Global Constraints and used consistently in Tasks 1 and 4.
