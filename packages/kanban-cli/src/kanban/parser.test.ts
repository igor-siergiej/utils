import { describe, expect, it } from 'vitest';
import { KanbanParseError } from './errors';
import { parseKanbanFile } from './parser';

const FIXTURE = `# Kanban Board

## Backlog

### Add dark mode toggle

\`\`\`yaml
id: shoppingo-042
repo: /home/igor/dev/shoppingo
tags: [ui, frontend]
retries: { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 }
\`\`\`

Add a dark/light theme toggle to Settings, persisted in localStorage.

**Acceptance criteria**
- Toggle appears in Settings > Appearance
- Theme persists across reloads

---

## In Progress

### Fix flaky checkout rounding

\`\`\`yaml
id: shoppingo-041
repo: /home/igor/dev/shoppingo
branch: fix/checkout-rounding
pr: 128
retries: { implement: 1, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 }
\`\`\`

Checkout total occasionally off by rounding error.

---

## Blocked

## Done
`;

describe('parseKanbanFile', () => {
    it('parses columns in file order', () => {
        const board = parseKanbanFile(FIXTURE);
        expect(board.columns.map((c) => c.name)).toEqual(['Backlog', 'In Progress', 'Blocked', 'Done']);
    });

    it('parses required and optional item fields', () => {
        const board = parseKanbanFile(FIXTURE);
        const [item] = board.columns[0].items;

        expect(item.id).toBe('shoppingo-042');
        expect(item.title).toBe('Add dark mode toggle');
        expect(item.column).toBe('Backlog');
        expect(item.repo).toBe('/home/igor/dev/shoppingo');
        expect(item.tags).toEqual(['ui', 'frontend']);
        expect(item.retries).toEqual({ implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 });
        expect(item.body).toContain('Toggle appears in Settings > Appearance');
        expect(item.body.startsWith('Add a dark/light')).toBe(true);
        expect(item.body.endsWith('Theme persists across reloads')).toBe(true);
    });

    it('parses branch/pr fields on in-progress items', () => {
        const board = parseKanbanFile(FIXTURE);
        const [item] = board.columns[1].items;

        expect(item.branch).toBe('fix/checkout-rounding');
        expect(item.pr).toBe(128);
        expect(item.retries.implement).toBe(1);
    });

    it('defaults retry counters when omitted', () => {
        const board = parseKanbanFile(`# Board

## Backlog

### Minimal item

\`\`\`yaml
id: min-1
repo: /tmp/repo
\`\`\`

Body text.
`);
        expect(board.columns[0].items[0].retries).toEqual({
            implement: 0,
            e2e_local: 0,
            ci: 0,
            deploy: 0,
            e2e_live: 0,
        });
    });

    it('supports empty columns', () => {
        const board = parseKanbanFile(FIXTURE);
        expect(board.columns[2].items).toEqual([]);
        expect(board.columns[3].items).toEqual([]);
    });

    it('throws on missing id', () => {
        expect(() =>
            parseKanbanFile(`# Board

## Backlog

### No id

\`\`\`yaml
repo: /tmp/repo
\`\`\`
`)
        ).toThrow(KanbanParseError);
    });

    it('throws on duplicate ids', () => {
        expect(() =>
            parseKanbanFile(`# Board

## Backlog

### Item A

\`\`\`yaml
id: dup-1
repo: /tmp/a
\`\`\`

## In Progress

### Item B

\`\`\`yaml
id: dup-1
repo: /tmp/b
\`\`\`
`)
        ).toThrow(/Duplicate item id/);
    });

    it('throws when an item appears before any column heading', () => {
        expect(() =>
            parseKanbanFile(`# Board

### Orphan item

\`\`\`yaml
id: orphan-1
repo: /tmp/a
\`\`\`
`)
        ).toThrow(/before any column/);
    });

    it('throws on a missing yaml metadata block', () => {
        expect(() =>
            parseKanbanFile(`# Board

## Backlog

### No metadata

Just a body, no yaml block.
`)
        ).toThrow(/missing its metadata block/);
    });
});

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
