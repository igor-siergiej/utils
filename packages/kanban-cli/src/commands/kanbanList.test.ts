import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kanbanList } from './kanbanList';

const board = (project: string, blocked: string) => `---
project: ${project}
---

# Board

## Backlog

## In Progress

## Blocked

${blocked}
## Done
`;

const blockedItem = (id: string, reason: string) => `### ${id} title

- **id:** ${id}
- **retries:** implement 0, e2e_local 0, ci 3, deploy 0, e2e_live 0
- **blocked_reason:** ${reason}

Body of ${id}.

---

`;

function boardsDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'kanban-list-'));
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
    return dir;
}

describe('kanbanList', () => {
    it('lists one column of a single board with board and project attached', () => {
        const dir = boardsDir({ 'a.board.md': board('alpha', blockedItem('a-1', 'ci failed')) });

        const result = kanbanList('Blocked', { kanban: join(dir, 'a.board.md') });

        expect(result.errors).toEqual([]);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            board: join(dir, 'a.board.md'),
            project: 'alpha',
            id: 'a-1',
            blockedReason: 'ci failed',
            retries: { ci: 3 },
        });
    });

    it('sweeps every *.board.md in a directory, ignoring other files', () => {
        const dir = boardsDir({
            'a.board.md': board('alpha', blockedItem('a-1', 'x')),
            'b.board.md': board('beta', blockedItem('b-1', 'y') + blockedItem('b-2', 'z')),
            'notes.md': 'not a board',
        });

        const result = kanbanList('Blocked', { allBoards: dir });

        expect(result.items.map((i) => i.id)).toEqual(['a-1', 'b-1', 'b-2']);
    });

    it('reports an unparseable board without dropping the others', () => {
        const dir = boardsDir({
            'a.board.md': board('alpha', blockedItem('a-1', 'x')),
            'broken.board.md': '# no frontmatter\n\n## Backlog\n',
        });

        const result = kanbanList('Blocked', { allBoards: dir });

        expect(result.items.map((i) => i.id)).toEqual(['a-1']);
        expect(result.errors).toEqual([{ board: join(dir, 'broken.board.md'), error: expect.any(String) }]);
    });

    it('requires a board or a boards directory', () => {
        expect(() => kanbanList('Blocked', {})).toThrow(/--all-boards/);
    });
});
