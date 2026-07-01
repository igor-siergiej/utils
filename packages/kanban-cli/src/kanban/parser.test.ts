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

    it('throws on missing repo', () => {
        expect(() =>
            parseKanbanFile(`# Board

## Backlog

### No repo

\`\`\`yaml
id: x-1
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
        ).toThrow(/missing its yaml metadata block/);
    });
});
