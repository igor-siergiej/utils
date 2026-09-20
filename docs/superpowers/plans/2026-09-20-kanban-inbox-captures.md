# Kanban Inbox Captures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give boards a `## Inbox` section that holds raw captures safely, make prose anywhere else a loud parse error, and add `inbox list/promote/drop` plus a refinement skill that grounds a capture in the target repo before promoting it to an item.

**Architecture:** `KanbanColumn` gains `captures: string[]`, stored verbatim. The parser accumulates capture blocks while inside the `Inbox` column and throws `KanbanParseError` for prose at any other scope. Three pure mutation functions (`listCaptures`, `promoteCapture`, `dropCapture`) back three new CLI commands, each a single read-modify-write through `readKanbanBoard`/`writeKanbanBoard`. Repo resolution becomes opt-out so checkout-less boards stay readable.

**Tech Stack:** TypeScript, Bun (runtime/package manager), vitest + v8 coverage, tsup (build), semantic-release (angular preset), Biome (lint/format, tab indent, 4-space width per repo config).

**Spec:** `docs/superpowers/specs/2026-09-20-kanban-inbox-captures-design.md`

## Global Constraints

- Package: `@imapps/kanban-cli` at `packages/kanban-cli/`. Version `0.11.0` → `1.0.0`.
- `INBOX_COLUMN = 'Inbox'`. NOT added to `REQUIRED_COLUMNS` — the five working boards have no Inbox and must keep parsing.
- `KanbanColumn.captures: string[]` is **non-optional**; every construction site (including every test fixture) sets it explicitly.
- Captures are stored and re-emitted **verbatim**, including any leading `- `. No normalisation. `parse → serialize` is byte-identical for captures.
- A capture is one blank-line-separated block of non-heading text; a block may span multiple lines.
- Prose outside `## Inbox` → `KanbanParseError` whose message contains the 1-based line number, the offending text truncated to 50 chars, the column name, and the remedy text `Raw notes are only allowed under '## Inbox'`.
- Capture indices are **1-based** everywhere (mutations, CLI, JSON output).
- `KanbanItem.repo` stays a required `string`. Unresolved repo is `''`, never `undefined`.
- Every command prints exactly one JSON object to stdout on success, `ok:true`. CLI-level failures print `{"ok":false,"error":...}` to stderr with a non-zero exit.
- Tests run with `bun run --filter @imapps/kanban-cli test` (`vitest run --coverage`). Import test helpers from `vitest`, never `bun:test`.
- Final commit only is `feat!` with a `BREAKING CHANGE:` footer. Intermediate commits are plain `feat`/`test`/`refactor`/`docs` so semantic-release records one breaking change, not several.
- This repo has no `commit-msg` hook and no commitlint config; `.husky/pre-commit` runs `bunx lint-staged`, which matches `*.{ts,mts,cts,json}` only.
- **`bunx tsc --noEmit` has a pre-existing baseline of 5 errors on clean `main`**, all unrelated to this work: 3 in `src/process/healthCheck.test.ts` (a `fetch` mock missing `preconnect`) and 2 in `src/process/pollForCondition.test.ts` (TS7011 implicit `any` return). `bun run test` passes because vitest does not typecheck. Every step below that runs `tsc --noEmit` therefore expects **no new errors beyond those 5**, not a clean run. Do not fix them here — out of scope.

---

### Task 1: `captures` on the column model

**Files:**
- Modify: `packages/kanban-cli/src/kanban/types.ts`
- Modify: `packages/kanban-cli/src/kanban/parser.ts:80-84` (column construction)
- Modify: `packages/kanban-cli/src/kanban/parser.test.ts` (fixtures gain `captures: []`)
- Modify: `packages/kanban-cli/src/kanban/serializer.test.ts` (fixtures gain `captures: []`)
- Modify: `packages/kanban-cli/src/kanban/mutations.test.ts` (fixtures gain `captures: []`)
- Modify: `packages/kanban-cli/src/kanban/io.test.ts` (fixtures gain `captures: []`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `INBOX_COLUMN: 'Inbox'` and `KanbanColumn.captures: string[]`, both imported by every later task.

- [ ] **Step 1: Add the constant and the field**

In `src/kanban/types.ts`, add below the existing `REQUIRED_COLUMNS` (line 6):

```ts
export const INBOX_COLUMN = 'Inbox';
```

and change `KanbanColumn`:

```ts
export interface KanbanColumn {
    name: string;
    items: KanbanItem[];
    captures: string[];
}
```

- [ ] **Step 2: Run the type check to enumerate every broken construction site**

Run: `cd packages/kanban-cli && bunx tsc --noEmit`
Expected: FAIL. Errors listing each place a `KanbanColumn` is built without `captures` — `src/kanban/parser.ts` plus the four test files above. This error list is your worklist for step 3.

- [ ] **Step 3: Fix every site**

In `src/kanban/parser.ts`, the column push (currently line 80):

```ts
currentColumn = { name: columnMatch[1], items: [], captures: [] };
```

In each of the four test files, add `captures: []` to every inline `KanbanColumn` literal. Do not change any assertion.

- [ ] **Step 4: Verify types and existing tests are green**

Run: `cd packages/kanban-cli && bunx tsc --noEmit && bun run test`
Expected: PASS, zero behaviour change.

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/src/kanban
git commit -m "refactor(kanban-cli): add captures field to the column model"
```

---

### Task 2: Parse captures inside `## Inbox`

**Files:**
- Modify: `packages/kanban-cli/src/kanban/parser.ts:68-105` (the main loop)
- Test: `packages/kanban-cli/src/kanban/parser.test.ts`

**Interfaces:**
- Consumes: `INBOX_COLUMN`, `KanbanColumn.captures` from Task 1.
- Produces: `parseKanbanFile` populating `captures` on the `Inbox` column. Task 4 (serializer) and Task 5 (mutations) rely on capture order matching document order.

- [ ] **Step 1: Write the failing tests**

Append to `src/kanban/parser.test.ts`:

```ts
describe('inbox captures', () => {
    const board = (inbox: string) => `---
project: demo
---

# Demo Board

## Inbox

${inbox}

## Backlog
`;

    it('captures a single bullet line verbatim, including the leading dash', () => {
        const parsed = parseKanbanFile(board('- Better loading when we import recipes'));
        const inbox = parsed.columns.find((c) => c.name === 'Inbox');
        expect(inbox?.captures).toEqual(['- Better loading when we import recipes']);
    });

    it('captures a bare paragraph with no bullet', () => {
        const parsed = parseKanbanFile(board('Desktop view of recipes looks cramped'));
        const inbox = parsed.columns.find((c) => c.name === 'Inbox');
        expect(inbox?.captures).toEqual(['Desktop view of recipes looks cramped']);
    });

    it('keeps a multi-line block as one capture', () => {
        const parsed = parseKanbanFile(board('first line\nsecond line'));
        const inbox = parsed.columns.find((c) => c.name === 'Inbox');
        expect(inbox?.captures).toEqual(['first line\nsecond line']);
    });

    it('splits blocks on blank lines, in document order', () => {
        const parsed = parseKanbanFile(board('- one\n\n- two\n\nthird thing'));
        const inbox = parsed.columns.find((c) => c.name === 'Inbox');
        expect(inbox?.captures).toEqual(['- one', '- two', 'third thing']);
    });

    it('leaves captures empty on columns that are not Inbox', () => {
        const parsed = parseKanbanFile(board('- one'));
        expect(parsed.columns.find((c) => c.name === 'Backlog')?.captures).toEqual([]);
    });

    it('parses a board with no Inbox column at all', () => {
        const parsed = parseKanbanFile(`---
project: demo
---

# Demo Board

## Backlog

### An item

- **id:** demo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body text.
`);
        expect(parsed.columns.map((c) => c.name)).toEqual(['Backlog']);
        expect(parsed.columns[0].items[0].id).toBe('demo-1');
    });

    it('allows items in the Inbox column to coexist with captures', () => {
        const parsed = parseKanbanFile(`---
project: demo
---

# Demo Board

## Inbox

- a capture

### An item

- **id:** demo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body.
`);
        const inbox = parsed.columns[0];
        expect(inbox.captures).toEqual(['- a capture']);
        expect(inbox.items).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/parser.test.ts -t "inbox captures"`
Expected: FAIL — `captures` is `[]` because the parser still skips the lines.

- [ ] **Step 3: Implement capture accumulation**

In `src/kanban/parser.ts`, add near the other regexes (after line 11):

```ts
const CAPTURE_TRUNCATE = 50;
```

Import `INBOX_COLUMN` from `./types`. Inside `parseKanbanFile`, declare alongside `currentColumn` (line 46):

```ts
let captureBlock: string[] = [];

const flushCapture = () => {
    if (!captureBlock.length) return;
    currentColumn?.captures.push(captureBlock.join('\n'));
    captureBlock = [];
};
```

Call `flushCapture()` immediately before each of the three `continue` branches that start a new heading (title at line 74, column at line 82, item at line 92) — a heading always ends an open block.

Replace the fall-through `i += 1` (line 104) with:

```ts
        if (line.trim() === '') {
            flushCapture();
            i += 1;
            continue;
        }

        if (currentColumn?.name === INBOX_COLUMN) {
            captureBlock.push(line);
            i += 1;
            continue;
        }

        i += 1;
```

After the `while` loop and before `return`, call `flushCapture()` so a capture at end-of-file is not lost.

Note: the column heading branch pushes the new column before `flushCapture` would run, so call `flushCapture()` as the **first** statement in that branch, before `currentColumn` is reassigned.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/parser.test.ts`
Expected: PASS, including all pre-existing parser tests.

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/src/kanban/parser.ts packages/kanban-cli/src/kanban/parser.test.ts
git commit -m "feat(kanban-cli): parse raw captures inside the Inbox column"
```

---

### Task 3: Reject prose outside `## Inbox`

**Files:**
- Modify: `packages/kanban-cli/src/kanban/parser.ts` (the `else` path from Task 2)
- Test: `packages/kanban-cli/src/kanban/parser.test.ts`

**Interfaces:**
- Consumes: the capture branch from Task 2.
- Produces: `KanbanParseError` for column-scope prose. Task 8's skill docs and Task 11's README quote this message.

- [ ] **Step 1: Write the failing tests**

Append to `src/kanban/parser.test.ts`:

```ts
describe('strict prose rejection', () => {
    const withStray = (body: string) => `---
project: demo
---

# Demo Board

${body}`;

    it('rejects prose in Backlog with line number, text, column and remedy', () => {
        const markdown = withStray(`## Backlog

Better way of showing loading when we import recipes and some more text here
`);
        let error: unknown;
        try {
            parseKanbanFile(markdown);
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(KanbanParseError);
        const message = (error as Error).message;
        expect(message).toContain('line 9');
        expect(message).toContain('Better way of showing loading when we import recipes');
        expect(message).toContain("column 'Backlog'");
        expect(message).toContain("Raw notes are only allowed under '## Inbox'");
    });

    it('truncates long stray text to 50 characters', () => {
        const long = 'x'.repeat(120);
        expect(() => parseKanbanFile(withStray(`## Backlog\n\n${long}\n`))).toThrow(
            new RegExp(`${'x'.repeat(50)}…`)
        );
    });

    it('rejects prose after an item body terminator', () => {
        const markdown = withStray(`## Backlog

### An item

- **id:** demo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body.

---

stray afterthought
`);
        expect(() => parseKanbanFile(markdown)).toThrow(KanbanParseError);
    });

    it('rejects prose before the first column heading', () => {
        expect(() => parseKanbanFile(withStray('a thought with no column yet\n'))).toThrow(
            KanbanParseError
        );
    });

    it('names the missing-inbox case when there is no column at all', () => {
        expect(() => parseKanbanFile(withStray('a thought\n'))).toThrow(/no column/);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/parser.test.ts -t "strict prose rejection"`
Expected: FAIL — the lines are currently skipped silently, nothing throws.

- [ ] **Step 3: Implement the error**

In `src/kanban/parser.ts`, replace the final bare `i += 1` from Task 2 with:

```ts
        const truncated =
            line.trim().length > CAPTURE_TRUNCATE
                ? `${line.trim().slice(0, CAPTURE_TRUNCATE)}…`
                : line.trim();
        const where = currentColumn ? `column '${currentColumn.name}'` : 'no column yet';

        throw new KanbanParseError(
            `line ${i + 1}: stray text '${truncated}' in ${where}. ` +
                `Raw notes are only allowed under '## Inbox' — move it there, ` +
                `or turn it into a '### item'.`
        );
```

`i` is 0-based, so the message uses `i + 1`.

- [ ] **Step 4: Run the full parser suite**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify no real board regresses**

Run:
```bash
cd packages/kanban-cli && bun run build
for f in /mnt/tank/shared/notes/kanban/*.board.md; do
  echo "== $(basename "$f")"
  node build/cli.js columns --kanban "$f"
done
```
Expected: `shoppingo`, `jewellery-catalogue`, `foundry`, `kanban-cli`, `taisei-karate` all print a `columns` array. `personal-portfolio` still fails with the repo-resolution error (fixed in Task 6/Task 10), NOT with a stray-text error. If any of the five reports stray text, stop and report it — the spec's migration claim was wrong.

- [ ] **Step 6: Commit**

```bash
git add packages/kanban-cli/src/kanban/parser.ts packages/kanban-cli/src/kanban/parser.test.ts
git commit -m "feat(kanban-cli): reject raw prose outside the Inbox column"
```

---

### Task 4: Serialize captures verbatim

**Files:**
- Modify: `packages/kanban-cli/src/kanban/serializer.ts:11-23`
- Test: `packages/kanban-cli/src/kanban/serializer.test.ts`

**Interfaces:**
- Consumes: `KanbanColumn.captures` (Task 1), parser capture order (Task 2).
- Produces: byte-identical capture round-trip, relied on by Task 5's mutation tests and Task 10's live migration.

- [ ] **Step 1: Write the failing tests**

Append to `src/kanban/serializer.test.ts`:

```ts
describe('capture serialization', () => {
    const roundTrip = (markdown: string) => serializeKanbanBoard(parseKanbanFile(markdown));

    const source = `---
project: demo
---

# Demo Board

## Inbox

- a bullet capture

a bare paragraph
spanning two lines

## Backlog

### An item

- **id:** demo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body.

---
`;

    it('round-trips captures byte-for-byte', () => {
        expect(roundTrip(source)).toBe(source);
    });

    it('is stable over a second round trip', () => {
        expect(roundTrip(roundTrip(source))).toBe(roundTrip(source));
    });

    it('emits just the heading for an empty Inbox', () => {
        const output = serializeKanbanBoard({
            title: 'Demo Board',
            project: 'demo',
            columns: [
                { name: 'Inbox', items: [], captures: [] },
                { name: 'Backlog', items: [], captures: [] },
            ],
        });
        expect(output).toContain('## Inbox\n\n## Backlog');
    });

    it('emits captures before items in the same column', () => {
        const output = serializeKanbanBoard({
            title: 'Demo Board',
            project: 'demo',
            columns: [
                {
                    name: 'Inbox',
                    captures: ['- a capture'],
                    items: [
                        {
                            id: 'demo-1',
                            title: 'An item',
                            column: 'Inbox',
                            repo: '',
                            body: 'Body.',
                            retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
                        },
                    ],
                },
            ],
        });
        expect(output.indexOf('- a capture')).toBeLessThan(output.indexOf('### An item'));
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/serializer.test.ts -t "capture serialization"`
Expected: FAIL — captures are dropped, so the round-trip output is missing them.

- [ ] **Step 3: Implement capture emission**

In `src/kanban/serializer.ts`, inside the column loop, directly after `lines.push(\`## ${column.name}\`, '')` (line 12):

```ts
        for (const capture of column.captures) {
            lines.push(capture, '');
        }
```

Captures are pushed as-is; a multi-line capture contains its own `\n` and `lines.join('\n')` reproduces it exactly.

- [ ] **Step 4: Run the serializer suite**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/serializer.test.ts`
Expected: PASS, including the pre-existing round-trip tests.

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/src/kanban/serializer.ts packages/kanban-cli/src/kanban/serializer.test.ts
git commit -m "feat(kanban-cli): serialize inbox captures verbatim"
```

---

### Task 5: Capture mutations

**Files:**
- Modify: `packages/kanban-cli/src/kanban/mutations.ts`
- Modify: `packages/kanban-cli/src/kanban/errors.ts`
- Test: `packages/kanban-cli/src/kanban/mutations.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces, imported by Tasks 6 and 7:

```ts
export class CaptureNotFoundError extends Error {}

export interface PromotedItemFields {
    id: string;
    title: string;
    tags?: string[];
    body?: string;
}

export function listCaptures(board: KanbanBoard): Array<{ index: number; text: string }>;
export function promoteCapture(
    board: KanbanBoard,
    index: number,
    fields: PromotedItemFields,
    toColumn?: string,
): KanbanBoard;
export function dropCapture(board: KanbanBoard, index: number): KanbanBoard;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/kanban/mutations.test.ts`:

```ts
describe('capture mutations', () => {
    const board = (): KanbanBoard => ({
        title: 'Demo Board',
        project: 'demo',
        columns: [
            { name: 'Inbox', items: [], captures: ['- one', '- two', 'three'] },
            { name: 'Backlog', items: [], captures: [] },
        ],
    });

    const fields = { id: 'demo-new', title: 'A promoted item' };

    it('lists captures 1-based in document order', () => {
        expect(listCaptures(board())).toEqual([
            { index: 1, text: '- one' },
            { index: 2, text: '- two' },
            { index: 3, text: 'three' },
        ]);
    });

    it('promote removes exactly that capture', () => {
        const next = promoteCapture(board(), 2, fields);
        expect(next.columns[0].captures).toEqual(['- one', 'three']);
    });

    it('promote appends a zeroed-retry item to Backlog by default', () => {
        const next = promoteCapture(board(), 1, { ...fields, tags: ['ux', 'P2'], body: 'Body.' });
        const backlog = next.columns.find((c) => c.name === 'Backlog');
        expect(backlog?.items).toHaveLength(1);
        expect(backlog?.items[0]).toMatchObject({
            id: 'demo-new',
            title: 'A promoted item',
            column: 'Backlog',
            tags: ['ux', 'P2'],
            body: 'Body.',
            retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
        });
    });

    it('promote honours an explicit target column', () => {
        const next = promoteCapture(board(), 1, fields, 'Inbox');
        expect(next.columns[0].items).toHaveLength(1);
    });

    it('promote rejects a duplicate id without mutating', () => {
        const withItem = board();
        withItem.columns[1].items.push({
            id: 'demo-new',
            title: 'Existing',
            column: 'Backlog',
            repo: '',
            body: '',
            retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
        });
        expect(() => promoteCapture(withItem, 1, fields)).toThrow(/demo-new/);
        expect(withItem.columns[0].captures).toHaveLength(3);
    });

    it('promote rejects an unknown target column', () => {
        expect(() => promoteCapture(board(), 1, fields, 'Nope')).toThrow(KanbanColumnNotFoundError);
    });

    it('drop removes one capture and leaves the rest', () => {
        expect(dropCapture(board(), 3).columns[0].captures).toEqual(['- one', '- two']);
    });

    it('rejects an out-of-range index, naming the valid range', () => {
        expect(() => dropCapture(board(), 4)).toThrow(CaptureNotFoundError);
        expect(() => dropCapture(board(), 4)).toThrow(/1-3/);
        expect(() => dropCapture(board(), 0)).toThrow(CaptureNotFoundError);
    });

    it('explains when the board has no Inbox column', () => {
        const noInbox: KanbanBoard = {
            title: 'Demo Board',
            project: 'demo',
            columns: [{ name: 'Backlog', items: [], captures: [] }],
        };
        expect(() => dropCapture(noInbox, 1)).toThrow(/no '## Inbox'/);
        expect(listCaptures(noInbox)).toEqual([]);
    });

    it('does not mutate the input board', () => {
        const original = board();
        dropCapture(original, 1);
        expect(original.columns[0].captures).toHaveLength(3);
    });

    it('refuses to move an item into Inbox', () => {
        const withItem = board();
        withItem.columns[1].items.push({
            id: 'demo-1',
            title: 'Existing',
            column: 'Backlog',
            repo: '',
            body: '',
            retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
        });
        expect(() => moveItem(withItem, 'demo-1', 'Inbox')).toThrow(/Inbox/);
    });
});
```

Add `CaptureNotFoundError`, `listCaptures`, `promoteCapture`, `dropCapture` to the existing import statement at the top of the file, and `KanbanBoard` to the type import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/mutations.test.ts -t "capture mutations"`
Expected: FAIL — the functions do not exist yet.

- [ ] **Step 3: Add the error class**

In `src/kanban/errors.ts`, following the style of the existing error classes:

```ts
export class CaptureNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CaptureNotFoundError';
    }
}
```

- [ ] **Step 4: Implement the mutations**

In `src/kanban/mutations.ts`, import `CaptureNotFoundError` from `./errors` and `INBOX_COLUMN` from `./types`, then add:

```ts
function locateInbox(board: KanbanBoard): number {
    const index = board.columns.findIndex((c) => c.name === INBOX_COLUMN);
    if (index === -1) {
        throw new CaptureNotFoundError(
            `this board has no '## Inbox' section, so it holds no captures`,
        );
    }
    return index;
}

export function listCaptures(board: KanbanBoard): Array<{ index: number; text: string }> {
    const column = board.columns.find((c) => c.name === INBOX_COLUMN);
    return (column?.captures ?? []).map((text, i) => ({ index: i + 1, text }));
}

function takeCapture(board: KanbanBoard, index: number) {
    const columnIndex = locateInbox(board);
    const captures = board.columns[columnIndex].captures;

    if (!Number.isInteger(index) || index < 1 || index > captures.length) {
        throw new CaptureNotFoundError(
            captures.length
                ? `no capture at index ${index}; valid range is 1-${captures.length}`
                : `no capture at index ${index}; the Inbox is empty`,
        );
    }

    const text = captures[index - 1];
    const columns = board.columns.map((column, i) =>
        i === columnIndex
            ? { ...column, captures: captures.filter((_, c) => c !== index - 1) }
            : column,
    );

    return { text, columns };
}

export function dropCapture(board: KanbanBoard, index: number): KanbanBoard {
    const { columns } = takeCapture(board, index);
    return { ...board, columns };
}

export function promoteCapture(
    board: KanbanBoard,
    index: number,
    fields: PromotedItemFields,
    toColumn = 'Backlog',
): KanbanBoard {
    const targetIndex = board.columns.findIndex((c) => c.name === toColumn);
    if (targetIndex === -1) throw new KanbanColumnNotFoundError(toColumn);

    const duplicate = board.columns.some((c) => c.items.some((item) => item.id === fields.id));
    if (duplicate) throw new KanbanParseError(`Duplicate item id '${fields.id}'`);

    const { columns } = takeCapture(board, index);

    const item: KanbanItem = {
        id: fields.id,
        title: fields.title,
        column: toColumn,
        repo: '',
        body: fields.body ?? '',
        retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
        ...(fields.tags?.length ? { tags: fields.tags } : {}),
    };

    return {
        ...board,
        columns: columns.map((column, i) =>
            i === targetIndex ? { ...column, items: [...column.items, item] } : column,
        ),
    };
}
```

Export `PromotedItemFields` from this module. Import `KanbanParseError` and `KanbanColumnNotFoundError` from `./errors` if not already imported, and `KanbanItem` from `./types`.

- [ ] **Step 5: Guard `moveItem` against Inbox**

In `moveItem` (line 26), immediately before the existing `findIndex`:

```ts
    if (toColumn === INBOX_COLUMN) {
        throw new KanbanColumnNotFoundError(
            `'${INBOX_COLUMN}' holds raw captures, not items — pick a work column`,
        );
    }
```

- [ ] **Step 6: Run the mutations suite**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/mutations.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/kanban-cli/src/kanban
git commit -m "feat(kanban-cli): add list, promote and drop capture mutations"
```

---

### Task 6: Durable writes and optional repo resolution

**Files:**
- Modify: `packages/kanban-cli/src/kanban/io.ts`
- Modify: `packages/kanban-cli/src/commands/kanbanColumns.ts`
- Test: `packages/kanban-cli/src/kanban/io.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: `readKanbanBoard(path, { requireRepo?: boolean })` — used by Task 7's three commands with `requireRepo: false`; and a `writeKanbanBoard` that succeeds on a read-only board file in a writable directory.

- [ ] **Step 1: Write the failing tests**

Append to `src/kanban/io.test.ts`, following the existing temp-directory helper style in that file:

```ts
describe('requireRepo', () => {
    const boardSource = `---
project: definitely-not-a-real-project
---

# Demo Board

## Inbox

- a capture

## Backlog
`;

    it('throws by default when the project has no checkout', () => {
        const file = writeTempBoard(boardSource);
        expect(() => readKanbanBoard(file)).toThrow(RepoResolutionError);
    });

    it('returns the board with empty repo when requireRepo is false', () => {
        const file = writeTempBoard(`---
project: definitely-not-a-real-project
---

# Demo Board

## Backlog

### An item

- **id:** demo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body.
`);
        const board = readKanbanBoard(file, { requireRepo: false });
        expect(board.columns[0].items[0].repo).toBe('');
    });

    it('still reads captures with requireRepo false', () => {
        const file = writeTempBoard(boardSource);
        const board = readKanbanBoard(file, { requireRepo: false });
        expect(board.columns[0].captures).toEqual(['- a capture']);
    });
});

describe('durable writes', () => {
    it('leaves no temp file behind', () => {
        const file = writeTempBoard(`---
project: demo
---

# Demo Board

## Backlog
`);
        const board = readKanbanBoard(file, { requireRepo: false });
        writeKanbanBoard(file, board);
        const siblings = readdirSync(dirname(file));
        expect(siblings.filter((name) => name !== basename(file))).toEqual([]);
    });

    it('updates a board file the user cannot open for writing', () => {
        const file = writeTempBoard(`---
project: demo
---

# Demo Board

## Inbox

- a capture

## Backlog
`);
        chmodSync(file, 0o444);

        const board = readKanbanBoard(file, { requireRepo: false });
        writeKanbanBoard(file, dropCapture(board, 1));

        expect(readFileSync(file, 'utf8')).not.toContain('a capture');
    });
});
```

Add the needed imports to the file: `basename`, `dirname` from `node:path`; `chmodSync`, `readdirSync`, `readFileSync` from `node:fs`; `dropCapture` from `./mutations`. `RepoResolutionError`, `mkdtempSync`, `writeFileSync`, `tmpdir` and `join` are already imported at the top of `io.test.ts`.

`io.test.ts` has no `writeTempBoard` helper, but it already has the fixtures to build one: a module-level `let root: string` created in `beforeEach` via `mkdtempSync(join(tmpdir(), 'kanban-cli-io-'))`, cleaned up in `afterEach`, with `KANBAN_CLI_REPO_ROOTS` pointed at `root` and a `shoppingo/.kanban-cli.json` seeded inside it. Add the helper next to that setup, reusing `root` so cleanup stays automatic:

```ts
function writeTempBoard(content: string): string {
    const file = join(root, `board-${Math.random().toString(36).slice(2)}.board.md`);
    writeFileSync(file, content);
    return file;
}
```

The existing `beforeEach` seeds a repo named `shoppingo` only, so a board whose project is `definitely-not-a-real-project` is genuinely unresolvable — that is what makes the `requireRepo` tests meaningful. Do not rename it to `shoppingo`.

Note on the read-only test: it asserts the behaviour the spec's §5 justification rests on. Run it as a non-root user — as root, file modes are not enforced and the test would pass even without the fix.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/kanban-cli && bunx vitest run src/kanban/io.test.ts`
Expected: FAIL. `readKanbanBoard` takes no second argument, and the read-only write throws `EACCES`.

- [ ] **Step 3: Implement both changes**

Rewrite `src/kanban/io.ts`:

```ts
import { renameSync, writeFileSync } from 'node:fs';
import { readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RepoResolutionError } from '../repoRegistry/errors';
import { resolveRepoPath } from '../repoRegistry/resolveRepo';
import { KanbanParseError } from './errors';
import { parseKanbanFile } from './parser';
import { serializeKanbanBoard } from './serializer';
import type { KanbanBoard } from './types';

export interface ReadKanbanBoardOptions {
    requireRepo?: boolean;
}

export function readKanbanBoard(path: string, opts: ReadKanbanBoardOptions = {}): KanbanBoard {
    const requireRepo = opts.requireRepo ?? true;
    const board = parseKanbanFile(readFileSync(path, 'utf8'));

    if (!board.project || board.project.trim() === '') {
        throw new KanbanParseError("Board file is missing its 'project' frontmatter (--- project: <name> ---)");
    }

    let repo = '';
    try {
        repo = resolveRepoPath(board.project);
    } catch (cause) {
        if (requireRepo || !(cause instanceof RepoResolutionError)) throw cause;
    }

    return {
        ...board,
        columns: board.columns.map((column) => ({
            ...column,
            items: column.items.map((item) => ({ ...item, repo })),
        })),
    };
}

export function writeKanbanBoard(path: string, board: KanbanBoard): void {
    const temp = join(dirname(path), `.${basename(path)}.tmp`);
    try {
        writeFileSync(temp, serializeKanbanBoard(board));
        renameSync(temp, path);
    } catch (cause) {
        try {
            unlinkSync(temp);
        } catch {
            // the temp file may not exist; the original error is what matters
        }
        throw cause;
    }
}
```

Only a `RepoResolutionError` is swallowed — a genuine parse or filesystem error still propagates.

- [ ] **Step 4: Make `columns` checkout-independent**

In `src/commands/kanbanColumns.ts`, change its `readKanbanBoard(path)` call to `readKanbanBoard(path, { requireRepo: false })`. Do not change `kanbanNext.ts`, `kanbanShow.ts`, `kanbanMove.ts` or `kanbanUpdate.ts` — they feed the worker, which needs a real path.

- [ ] **Step 5: Run the suite**

Run: `cd packages/kanban-cli && bunx tsc --noEmit && bun run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kanban-cli/src/kanban/io.ts packages/kanban-cli/src/kanban/io.test.ts packages/kanban-cli/src/commands/kanbanColumns.ts
git commit -m "feat(kanban-cli): atomic board writes and optional repo resolution"
```

---

### Task 7: `inbox` commands and CLI wiring

**Files:**
- Create: `packages/kanban-cli/src/commands/inboxList.ts`
- Create: `packages/kanban-cli/src/commands/inboxPromote.ts`
- Create: `packages/kanban-cli/src/commands/inboxDrop.ts`
- Create: `packages/kanban-cli/src/commands/inboxPromote.test.ts`
- Modify: `packages/kanban-cli/src/cli.ts`
- Modify: `packages/kanban-cli/src/index.ts`

**Interfaces:**
- Consumes: `listCaptures`, `promoteCapture`, `dropCapture`, `PromotedItemFields` (Task 5); `readKanbanBoard`/`writeKanbanBoard` (Task 6).
- Produces: the three CLI commands the Task 8 skill drives.

- [ ] **Step 1: Write the failing test for argument handling**

Create `src/commands/inboxPromote.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inboxPromote } from './inboxPromote';

const board = `---
project: demo
---

# Demo Board

## Inbox

- a capture

## Backlog
`;

function tempBoard(): string {
    const file = join(mkdtempSync(join(tmpdir(), 'kanban-promote-')), 'demo.board.md');
    writeFileSync(file, board);
    return file;
}

describe('inboxPromote', () => {
    it('promotes a capture and reports both the capture and the new item', () => {
        const file = tempBoard();
        const result = inboxPromote(file, 1, { id: 'demo-new', title: 'Promoted', tags: ['P2'] });

        expect(result.ok).toBe(true);
        expect(result.promoted).toEqual({ index: 1, text: '- a capture' });
        expect(result.item.id).toBe('demo-new');
        expect(result.item.column).toBe('Backlog');
    });

    it('rejects a body given both inline and by file', () => {
        const file = tempBoard();
        expect(() =>
            inboxPromote(file, 1, { id: 'demo-new', title: 'Promoted' }, { body: 'x', bodyFile: 'y' }),
        ).toThrow(/--body and --body-file/);
    });

    it('reads the body from a file', () => {
        const file = tempBoard();
        const bodyFile = join(mkdtempSync(join(tmpdir(), 'kanban-body-')), 'body.md');
        writeFileSync(bodyFile, 'Grounded body.\n');

        const result = inboxPromote(file, 1, { id: 'demo-new', title: 'Promoted' }, { bodyFile });
        expect(result.item.body).toBe('Grounded body.');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/kanban-cli && bunx vitest run src/commands/inboxPromote.test.ts`
Expected: FAIL — `./inboxPromote` does not exist.

- [ ] **Step 3: Implement the three commands**

`src/commands/inboxList.ts`:

```ts
import { readKanbanBoard } from '../kanban/io';
import { listCaptures } from '../kanban/mutations';

export function inboxList(boardPath: string) {
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    return { ok: true as const, captures: listCaptures(board) };
}
```

`src/commands/inboxDrop.ts`:

```ts
import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { dropCapture, listCaptures } from '../kanban/mutations';

export function inboxDrop(boardPath: string, index: number, reason?: string) {
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    const text = listCaptures(board).find((c) => c.index === index)?.text;

    writeKanbanBoard(boardPath, dropCapture(board, index));

    return {
        ok: true as const,
        dropped: { index, text },
        ...(reason ? { reason } : {}),
    };
}
```

`src/commands/inboxPromote.ts`:

```ts
import { readFileSync } from 'node:fs';
import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { listCaptures, promoteCapture, type PromotedItemFields } from '../kanban/mutations';

export interface InboxPromoteBodyOptions {
    body?: string;
    bodyFile?: string;
    column?: string;
}

export function inboxPromote(
    boardPath: string,
    index: number,
    fields: Omit<PromotedItemFields, 'body'>,
    opts: InboxPromoteBodyOptions = {},
) {
    if (opts.body !== undefined && opts.bodyFile !== undefined) {
        throw new Error('--body and --body-file are mutually exclusive');
    }

    const body = opts.bodyFile ? readFileSync(opts.bodyFile, 'utf8').trimEnd() : opts.body;
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    const text = listCaptures(board).find((c) => c.index === index)?.text;

    const next = promoteCapture(board, index, { ...fields, body }, opts.column);
    writeKanbanBoard(boardPath, next);

    const column = opts.column ?? 'Backlog';
    const item = next.columns
        .find((c) => c.name === column)
        ?.items.find((candidate) => candidate.id === fields.id);

    return { ok: true as const, promoted: { index, text }, item: item! };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/kanban-cli && bunx vitest run src/commands/inboxPromote.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the CLI**

In `src/cli.ts`, add an `inbox` case to the `switch (command)` in `main()`, mirroring the existing `e2e`/`pr` group style: read the sub-verb, then use `parseArgs` from `node:util` (as every other case does) for the flags. Parse `list` / `promote <index>` / `drop <index>`, read `--kanban`, and for `promote` read `--id`, `--title`, `--tags` (comma-separated), `--body`, `--body-file`, `--column`; for `drop` read `--reason`. Print results with the existing `printSuccess` helper. For a missing `--id`/`--title` or a non-integer index, just `throw new Error(...)` — `main().catch` already routes it through `printError` and `process.exit(1)`, producing the `{"ok":false,...}`-on-stderr contract. Add the three commands to the `USAGE` constant.

```
kanban-cli inbox list [--kanban <path>]
kanban-cli inbox promote <index> --id <id> --title <t> [--tags a,b] [--body <text> | --body-file <path>] [--column <name>] [--kanban <path>]
kanban-cli inbox drop <index> [--reason <text>] [--kanban <path>]
```

In `src/index.ts`, add the three `export * from './commands/inbox*'` lines in alphabetical position.

- [ ] **Step 6: Verify end to end against a scratch board**

Run:
```bash
cd packages/kanban-cli && bun run build
cp /mnt/tank/shared/notes/kanban/shoppingo.board.md /tmp/inbox-demo.board.md
printf '## Inbox\n\n- try the new inbox flow\n\n' > /tmp/inbox-head.md
# insert the Inbox section directly above "## Backlog"
awk 'NR==FNR{head=head $0 ORS; next} /^## Backlog/ && !done {printf "%s", head; done=1} {print}' /tmp/inbox-head.md /tmp/inbox-demo.board.md > /tmp/inbox-ready.board.md
KANBAN_CLI_REPO_ROOTS=/home/home/imapps node build/cli.js inbox list --kanban /tmp/inbox-ready.board.md
KANBAN_CLI_REPO_ROOTS=/home/home/imapps node build/cli.js inbox promote 1 --id shoppingo-inbox-smoke --title "smoke test item" --tags ux,P3 --body "Body." --kanban /tmp/inbox-ready.board.md
KANBAN_CLI_REPO_ROOTS=/home/home/imapps node build/cli.js inbox list --kanban /tmp/inbox-ready.board.md
KANBAN_CLI_REPO_ROOTS=/home/home/imapps node build/cli.js next --kanban /tmp/inbox-ready.board.md
```
Expected: the first `inbox list` shows one capture at index 1; `promote` returns the new item; the second `inbox list` shows `captures: []`; `next` still returns `shoppingo-recipes-desktop-layout` (the promoted item was appended last, so it is not next). Delete the scratch files afterwards.

- [ ] **Step 7: Commit**

```bash
git add packages/kanban-cli/src/commands packages/kanban-cli/src/cli.ts packages/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): add inbox list, promote and drop commands"
```

---

### Task 8: Multi-skill packaging and the refinement skill

**Files:**
- Create: `packages/kanban-cli/skill/refining-kanban-captures/SKILL.md`
- Move: `packages/kanban-cli/skill/SKILL.md` → `packages/kanban-cli/skill/kanban-worker/SKILL.md`
- Modify: `packages/kanban-cli/src/commands/installSkill.ts`
- Create: `packages/kanban-cli/src/commands/installSkill.test.ts`

**Interfaces:**
- Consumes: the CLI commands from Task 7 (the skill's procedure calls them).
- Produces: `installSkill(target, { mode?, skill? })` returning `{ok, installed, skipped}`.

- [ ] **Step 1: Write the failing test**

Create `src/commands/installSkill.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSkill } from './installSkill';

const target = () => mkdtempSync(join(tmpdir(), 'kanban-skills-'));

describe('installSkill', () => {
    it('installs every packaged skill by default', () => {
        const dir = target();
        const result = installSkill(dir);

        expect(result.ok).toBe(true);
        expect(result.installed.map((entry) => entry.skill).sort()).toEqual([
            'kanban-worker',
            'refining-kanban-captures',
        ]);
        expect(existsSync(join(dir, 'kanban-worker', 'SKILL.md'))).toBe(true);
        expect(existsSync(join(dir, 'refining-kanban-captures', 'SKILL.md'))).toBe(true);
    });

    it('installs only the named skill', () => {
        const dir = target();
        const result = installSkill(dir, { skill: 'refining-kanban-captures' });

        expect(result.installed.map((entry) => entry.skill)).toEqual(['refining-kanban-captures']);
        expect(existsSync(join(dir, 'kanban-worker'))).toBe(false);
    });

    it('skips an already-installed skill while installing a new one', () => {
        const dir = target();
        mkdirSync(join(dir, 'kanban-worker'), { recursive: true });
        writeFileSync(join(dir, 'kanban-worker', 'SKILL.md'), 'existing');

        const result = installSkill(dir);

        expect(result.skipped.map((entry) => entry.skill)).toEqual(['kanban-worker']);
        expect(result.installed.map((entry) => entry.skill)).toEqual(['refining-kanban-captures']);
    });

    it('errors on an unknown skill name', () => {
        expect(() => installSkill(target(), { skill: 'nope' })).toThrow(/nope/);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/kanban-cli && bunx vitest run src/commands/installSkill.test.ts`
Expected: FAIL — `installSkill` returns `{ok,path,mode}` and knows only one skill.

- [ ] **Step 3: Move the existing skill file**

```bash
cd packages/kanban-cli && mkdir -p skill/kanban-worker && git mv skill/SKILL.md skill/kanban-worker/SKILL.md
```

- [ ] **Step 4: Generalise `installSkill`**

Rewrite `src/commands/installSkill.ts`:

```ts
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = ['kanban-worker', 'refining-kanban-captures'] as const;
export type PackagedSkill = (typeof SKILLS)[number];

function packagedSkillPath(skill: string): string {
    // build/cli.{js,mjs} -> ../skill/<skill>/SKILL.md (the package root's skill/ directory).
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'skill', skill, 'SKILL.md');
}

export interface InstallSkillOptions {
    mode?: 'symlink' | 'copy';
    skill?: string;
}

export function installSkill(target: string, options: InstallSkillOptions = {}) {
    const mode = options.mode ?? 'copy';

    if (options.skill && !SKILLS.includes(options.skill as PackagedSkill)) {
        throw new Error(`unknown skill '${options.skill}'; packaged skills are: ${SKILLS.join(', ')}`);
    }

    const requested = options.skill ? [options.skill] : [...SKILLS];
    const installed: Array<{ skill: string; path: string; mode: string }> = [];
    const skipped: Array<{ skill: string; path: string; reason: 'already_installed' }> = [];

    for (const skill of requested) {
        const destDir = join(target, skill);
        const destFile = join(destDir, 'SKILL.md');

        if (existsSync(destFile)) {
            skipped.push({ skill, path: destFile, reason: 'already_installed' });
            continue;
        }

        mkdirSync(destDir, { recursive: true });
        const source = packagedSkillPath(skill);

        if (mode === 'symlink') symlinkSync(source, destFile);
        else copyFileSync(source, destFile);

        installed.push({ skill, path: destFile, mode });
    }

    return { ok: true as const, installed, skipped };
}
```

In `src/cli.ts`, add `--skill <name>` to the `install-skill` argument parsing and its usage line.

- [ ] **Step 5: Write the refinement skill**

Create `skill/refining-kanban-captures/SKILL.md`. Frontmatter `name: refining-kanban-captures` and a `description` naming the trigger phrases ("refine the board", "drain the inbox", "refine my captures"). Body sections, matching the spec's §7:

1. **When to use** — a human asks to refine/drain a board's Inbox. Never invoked automatically by the worker.
2. **Procedure** — `kanban-cli inbox list --kanban <board>`; for each capture resolve the project's checkout; **investigate the repo before writing anything**; then promote, report-as-shipped, or narrow.
3. **The investigation is the work** — state explicitly that a capture is one sentence of intent while an item is a contract, so a promoted item must name real files and symbols. Include the 2026-09-20 evidence: a capture asking to "add snapshots" for the recipes page was already fully shipped (a `desktop-visual` Playwright project with committed baselines gating every PR), and the same review found five merged PRs parked in `In Progress`.
4. **Outcomes** — outstanding → `inbox promote` with a `P1`/`P2`/`P3` tag and a body stating current behaviour with paths, what already exists and must not be rebuilt, and verifiable acceptance criteria. Already shipped → report with PR number and file path, recommend `inbox drop --reason`, let the human decide. Partially shipped → promote a narrowed item naming the shipped part as done.
5. **No checkout** — if `item.repo` is empty (the project has no local clone, e.g. `personal-portfolio`), report that and refuse to promote. Do not invent acceptance criteria for code you cannot read.
6. **Anti-patterns** — inventing acceptance criteria from the capture's wording alone; promoting a capture whose feature already exists; writing "add tests" when the infrastructure already covers it; promoting more than one item per capture without saying so.
7. **Body formatting** — pass the body via `--body-file`, because a grounded body is multi-paragraph with backticks and newlines that do not survive shell argument quoting.

- [ ] **Step 6: Update the worker skill**

In `skill/kanban-worker/SKILL.md`, add to its board-reading section: `## Inbox` holds raw captures, is never work, and is never drained by the worker; a `KanbanParseError` (including stray-text errors) means **stop and report**, never attempt to repair the board.

- [ ] **Step 7: Run the suite**

Run: `cd packages/kanban-cli && bunx tsc --noEmit && bun run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/kanban-cli/skill packages/kanban-cli/src/commands/installSkill.ts packages/kanban-cli/src/commands/installSkill.test.ts packages/kanban-cli/src/cli.ts
git commit -m "feat(kanban-cli): package the capture-refinement skill alongside the worker"
```

---

### Task 9: README

**Files:**
- Modify: `packages/kanban-cli/README.md:25-72` (board file), `:180-213` (CLI reference), `:215-` (known limitations)

**Interfaces:**
- Consumes: the finished behaviour of Tasks 2-8.
- Produces: nothing code-facing.

- [ ] **Step 1: Document the format**

In "The board file", add `## Inbox` to the example board above `## Backlog`, showing one `- bullet` capture and one bare-paragraph capture. State: `Inbox` is optional; it holds raw captures, not items; a capture is one blank-line-separated block; both `- bullet` and bare paragraph are accepted and stored verbatim; captures are ignored by `next` and the worker.

- [ ] **Step 2: Document the strict rule**

Add a short subsection stating that raw prose is legal **only** under `## Inbox`, and that prose in any other column is a `KanbanParseError` quoting the real message shape:

```
line 9: stray text 'Can we fix desktop view of the recipes page and le…' in column 'Backlog'.
Raw notes are only allowed under '## Inbox' — move it there, or turn it into a '### item'.
```

Explain why: before this, such text was silently discarded on the next write.

- [ ] **Step 3: Document the commands**

Add to the CLI reference block:

```
kanban-cli inbox list [--kanban <path>]
kanban-cli inbox promote <index> --id <id> --title <t> [--tags a,b]
                         [--body <text> | --body-file <path>] [--column <name>] [--kanban <path>]
kanban-cli inbox drop <index> [--reason <text>] [--kanban <path>]
```

Note that indices are 1-based and come from `inbox list`, and that `install-skill` now takes `--skill <name>` and installs both packaged skills by default.

- [ ] **Step 4: Update known limitations**

Add: a stray-prose parse error blocks every command on that board, including read-only ones, so an unattended worker run halts until the board is fixed — deliberate, chosen over silently dropping the text. Also note `columns` and the `inbox` commands work without a local checkout, while `next`/`show`/`move`/`update` still require one.

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/README.md
git commit -m "docs(kanban-cli): document the Inbox section and inbox commands"
```

---

### Task 10: Migrate the live boards and notes

**Files:**
- Modify: `/mnt/tank/shared/notes/kanban/personal-portfolio.board.md`
- Modify: `/mnt/tank/shared/notes/kanban/index.md`
- Modify: `/home/home/dotfiles/claude/.claude/skills/kanban-worker/SKILL.md`
- Create: `/home/home/dotfiles/claude/.claude/skills/refining-kanban-captures/SKILL.md`
- Modify: `/home/home/dotfiles/claude/.claude/skills/notes-kanban/SKILL.md`

**Interfaces:**
- Consumes: the built CLI from Tasks 2-9.
- Produces: live boards in the new format; installed skills matching the packaged ones.

These files are outside the repo, on a Resilio-synced mount. There is no commit step for them.

- [ ] **Step 1: Check for sync conflicts first**

Run: `find /mnt/tank/shared/notes -name '*sync-conflict*' -not -path '*/.sync/*'`
Expected: no output. If anything is listed, stop and ask which side to keep — never overwrite a conflicted file.

- [ ] **Step 2: Migrate personal-portfolio**

Run:
```bash
cd /home/home/imapps/utils/packages/kanban-cli
cp /mnt/tank/shared/notes/kanban/personal-portfolio.board.md /tmp/pp-backup.board.md
node build/cli.js migrate /mnt/tank/shared/notes/kanban/personal-portfolio.board.md --project personal-portfolio
```
Expected: `{"ok":true,"project":"personal-portfolio",...}`.

- [ ] **Step 3: Verify nothing was lost**

Run:
```bash
grep -c '^id:' /tmp/pp-backup.board.md
grep -c '^- \*\*id:\*\*' /mnt/tank/shared/notes/kanban/personal-portfolio.board.md
node build/cli.js columns --kanban /mnt/tank/shared/notes/kanban/personal-portfolio.board.md
```
Expected: both counts are `7`, and `columns` now succeeds (it no longer needs a checkout). `next` will still fail with the repo-resolution error until that repo is cloned — correct and expected.

- [ ] **Step 4: Add an `## Inbox` section to every board**

For each of the six boards in `/mnt/tank/shared/notes/kanban/`, hand-insert an `## Inbox` heading directly above `## Backlog`, with no captures under it. Then verify all six:

```bash
for f in /mnt/tank/shared/notes/kanban/*.board.md; do
  printf '%-30s ' "$(basename "$f")"
  node build/cli.js columns --kanban "$f"
done
```
Expected: all six print a `columns` array whose first entry is `Inbox`.

- [ ] **Step 5: Update the notes index**

In `/mnt/tank/shared/notes/kanban/index.md`: document `## Inbox` in the worker-boards paragraph (raw captures go there, one bullet or paragraph each, drained by the `refining-kanban-captures` skill); state the strict rule that prose anywhere else is a parse error; and delete the now-stale sentence saying `personal-portfolio`'s board predates the `project:` frontmatter format and needs `migrate` (keep the note that its repo is not cloned yet). Update the `updated:` frontmatter date.

- [ ] **Step 6: Install the skills**

Copy both packaged skills into the dotfiles repo, which is the live location symlinked from `~/.agents/skills/`:

```bash
cd /home/home/imapps/utils/packages/kanban-cli
node build/cli.js install-skill --target /home/home/dotfiles/claude/.claude/skills --skill refining-kanban-captures
cp skill/kanban-worker/SKILL.md /home/home/dotfiles/claude/.claude/skills/kanban-worker/SKILL.md
diff skill/kanban-worker/SKILL.md /home/home/dotfiles/claude/.claude/skills/kanban-worker/SKILL.md
diff skill/refining-kanban-captures/SKILL.md /home/home/dotfiles/claude/.claude/skills/refining-kanban-captures/SKILL.md
```
Expected: both diffs are empty. (`install-skill` skips `kanban-worker` because it already exists, hence the explicit copy.)

- [ ] **Step 7: Update the notes-kanban skill**

In `/home/home/dotfiles/claude/.claude/skills/notes-kanban/SKILL.md`, in the `*.board.md` section: raw thoughts go under `## Inbox`, never loose in another column, because prose elsewhere is now a hard parse error; refining captures into items is the `refining-kanban-captures` skill's job.

- [ ] **Step 8: Commit the dotfiles changes**

```bash
cd /home/home/dotfiles && git add claude/.claude/skills && \
  git commit -m "feat(skills): add refining-kanban-captures, teach boards about ## Inbox"
```

---

### Task 11: Release

**Files:**
- No source changes; this task only creates the breaking-change commit and verifies the whole suite.

**Interfaces:**
- Consumes: Tasks 1-10.

- [ ] **Step 1: Full verification**

Run:
```bash
cd /home/home/imapps/utils
bun run lint
bunx tsc --noEmit
bun run --filter @imapps/kanban-cli test
```
Expected: all pass. Note the package's `vitest.config.ts` sets coverage reporters but no thresholds, so coverage is reported, not enforced — do not expect a failure from coverage alone.

- [ ] **Step 2: Confirm the working tree holds only intended changes**

Run: `git status --porcelain`
Expected: clean, or only the pre-existing untracked `.kanban-cli.json` (not part of this work — do not commit it).

- [ ] **Step 3: Create the breaking-change commit**

All code is already committed by earlier tasks, so make this an empty marker commit carrying the footer semantic-release reads:

```bash
git commit --allow-empty -m "feat(kanban-cli)!: raw captures live in ## Inbox" -m "BREAKING CHANGE: raw prose is now only allowed under a board's ## Inbox column. Prose in any other column previously parsed and was silently discarded on the next write; it now throws a KanbanParseError naming the line, the text and the remedy. Boards with no ## Inbox section keep parsing unchanged."
```

- [ ] **Step 4: Verify the release will be a major bump**

Run: `bun run release:dry 2>&1 | grep -iE 'next release|major'` (the root `package.json` defines `release:dry` as `bunx semantic-release --dry-run --no-ci`)
Expected: reports the next version as `1.0.0`. If it reports a minor bump, the `BREAKING CHANGE:` footer is malformed — fix the commit message with `git commit --amend` before pushing.

- [ ] **Step 5: Push**

```bash
git push
```

Expected: CI runs, semantic-release publishes `1.0.0`.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §1 format & model | 1, 2, 4 |
| §2 strict parsing | 3 |
| §3 mutations | 5 |
| §4 serialization | 4 |
| §5 durable writes | 6 |
| §6 CLI surface | 7 |
| §7 refinement skill | 8 |
| §8 skill packaging | 8 |
| §9 no local checkout + personal-portfolio | 6, 10 |
| §10 files | all |
| §11 tests | 1-8 |
| Release | 11 |

No spec section is unimplemented.

**Type consistency check** — `captures: string[]` (Task 1) is used identically in Tasks 2, 4, 5. `PromotedItemFields` is defined in Task 5 and consumed in Task 7 via `Omit<PromotedItemFields, 'body'>`, because the command layer resolves the body from `--body`/`--body-file` before calling the mutation. `readKanbanBoard(path, { requireRepo })` is defined in Task 6 and used with that exact shape in Tasks 6 and 7. `CaptureNotFoundError` is created in Task 5 and asserted in Task 5's tests only. `installSkill`'s `{ok, installed, skipped}` shape is defined and asserted in Task 8.

**Known ordering constraint** — Task 3 (strict rejection) must land after Task 2 (capture parsing), or the parser would throw on Inbox captures too. Task 10 requires a build from Tasks 2-9. Tasks 1-8 are otherwise strictly sequential; nothing here parallelises safely because they all touch `src/kanban/`.

---

## Execution notes (2026-09-20)

Deviations from the plan as written, and why:

1. **`tsc --noEmit` baseline.** The repo already had 5 type errors on clean
   `main` (3 `fetch`-mock, 2 TS7011, all in `src/process/*.test.ts`). Captured
   in Global Constraints; every check verified "no new errors beyond those 5".
2. **`moveItem`'s Inbox guard uses a new `InboxNotAWorkColumnError`, not
   `KanbanColumnNotFoundError`.** That class builds its own message from a
   column name, so passing explanatory text would have produced "Kanban column
   'Inbox holds raw captures…' does not exist" — misleading, since `Inbox`
   does exist.
3. **Task 7 Step 5's `src/index.ts` exports were skipped.** `index.ts` exports
   no command modules at all; adding three would have broken that convention.
4. **Task 4's "captures before items" test was strengthened.** As first
   written it passed vacuously, because a missing capture makes `indexOf`
   return `-1`, which is always less than the item's index. It now asserts the
   capture is present first.
5. **Task 3's error-message test fixture was shortened.** The original 51-char
   fixture collided with the 50-char truncation, so the assertion could never
   match. Truncation remains covered by its own test.
6. **Extra commit: `fix(kanban-cli): resolve packaged skill path in the CJS
   bundle`.** Pre-existing bug found by running the built CLI in Task 10:
   `tsup` emits CJS where `import.meta.url` is shimmed to `undefined`, so
   `install-skill` threw `The "path" argument must be of type string` and had
   never worked from `build/cli.js`. The unit tests missed it because vitest
   runs the ESM source; resolution now prefers `__dirname`.

Not done, deliberately: the 5 pre-existing type errors and the 7 pre-existing
Biome warnings (all in `api-utils`/`web-utils`) were left alone as out of
scope.
