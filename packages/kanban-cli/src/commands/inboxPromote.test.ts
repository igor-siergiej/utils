import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inboxDrop } from './inboxDrop';
import { inboxList } from './inboxList';
import { inboxPromote } from './inboxPromote';

const BOARD = `---
project: demo
---

# Demo Board

## Inbox

- a capture

- another capture

## Backlog
`;

function tempBoard(): string {
    const file = join(mkdtempSync(join(tmpdir(), 'kanban-inbox-')), 'demo.board.md');
    writeFileSync(file, BOARD);
    return file;
}

describe('inboxList', () => {
    it('lists every capture with a 1-based index', () => {
        expect(inboxList(tempBoard())).toEqual({
            ok: true,
            captures: [
                { index: 1, text: '- a capture' },
                { index: 2, text: '- another capture' },
            ],
        });
    });
});

describe('inboxPromote', () => {
    it('promotes a capture and reports both the capture and the new item', () => {
        const file = tempBoard();
        const result = inboxPromote(file, 1, { id: 'demo-new', title: 'Promoted', tags: ['P2'] });

        expect(result.ok).toBe(true);
        expect(result.promoted).toEqual({ index: 1, text: '- a capture' });
        expect(result.item?.id).toBe('demo-new');
        expect(result.item?.column).toBe('Backlog');
    });

    it('persists the promotion to disk', () => {
        const file = tempBoard();
        inboxPromote(file, 1, { id: 'demo-new', title: 'Promoted' });

        const written = readFileSync(file, 'utf8');
        expect(written).toContain('### Promoted');
        expect(written).toContain('- **id:** demo-new');
        expect(written).not.toContain('- a capture');
        expect(written).toContain('- another capture');
    });

    it('rejects a body given both inline and by file', () => {
        expect(() =>
            inboxPromote(tempBoard(), 1, { id: 'demo-new', title: 'Promoted' }, { body: 'x', bodyFile: 'y' })
        ).toThrow(/--body and --body-file/);
    });

    it('reads the body from a file', () => {
        const bodyFile = join(mkdtempSync(join(tmpdir(), 'kanban-body-')), 'body.md');
        writeFileSync(bodyFile, 'Grounded body.\n');

        const result = inboxPromote(tempBoard(), 1, { id: 'demo-new', title: 'Promoted' }, { bodyFile });
        expect(result.item?.body).toBe('Grounded body.');
    });
});

describe('inboxDrop', () => {
    it('drops a capture and echoes the reason', () => {
        const file = tempBoard();
        const result = inboxDrop(file, 2, 'already shipped in #142');

        expect(result.dropped).toEqual({ index: 2, text: '- another capture' });
        expect(result.reason).toBe('already shipped in #142');
        expect(readFileSync(file, 'utf8')).not.toContain('- another capture');
    });

    it('omits the reason key when none is given', () => {
        expect(inboxDrop(tempBoard(), 1)).not.toHaveProperty('reason');
    });
});
