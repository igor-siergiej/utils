import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kanbanPrune } from './kanbanPrune';

const item = (id: string) => `### ${id} title

- **id:** ${id}
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body of ${id}.

---

`;

const board = (project: string, backlog: string, done: string) => `---
project: ${project}
---

# Board

## Inbox

- keep this capture

## Backlog

${backlog}## In Progress

## Blocked

## Done

${done}`;

function boardsDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'kanban-prune-'));
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
    return dir;
}

describe('kanbanPrune', () => {
    it('deletes every Done item and keeps the rest of the board', () => {
        const dir = boardsDir({ 'a.board.md': board('alpha', item('a-1'), item('a-2') + item('a-3')) });
        const path = join(dir, 'a.board.md');

        const result = kanbanPrune({ kanban: path });

        expect(result.pruned).toEqual([{ board: path, project: 'alpha', ids: ['a-2', 'a-3'] }]);
        const written = readFileSync(path, 'utf8');
        expect(written).toContain('### a-1 title');
        expect(written).toContain('- keep this capture');
        expect(written).not.toContain('a-2');
        expect(written).toMatch(/## Done\s*$/);
    });

    it('sweeps all boards and leaves boards with an empty Done untouched on disk', () => {
        const dir = boardsDir({
            'a.board.md': board('alpha', '', item('a-1')),
            'b.board.md': board('beta', item('b-1'), ''),
        });
        const untouched = join(dir, 'b.board.md');
        const before = statSync(untouched).mtimeMs;

        const result = kanbanPrune({ allBoards: dir });

        expect(result.pruned.map((p) => p.project)).toEqual(['alpha']);
        expect(statSync(untouched).mtimeMs).toBe(before);
    });

    it('reports an unparseable board without touching it', () => {
        const dir = boardsDir({ 'broken.board.md': '# no frontmatter\n\n## Done\n' });

        const result = kanbanPrune({ allBoards: dir });

        expect(result.pruned).toEqual([]);
        expect(result.errors).toEqual([{ board: join(dir, 'broken.board.md'), error: expect.any(String) }]);
    });

    it('refuses to prune the Inbox', () => {
        const dir = boardsDir({ 'a.board.md': board('alpha', '', '') });

        const result = kanbanPrune({ kanban: join(dir, 'a.board.md') }, 'Inbox');

        expect(result.errors[0].error).toMatch(/Inbox/);
    });
});
