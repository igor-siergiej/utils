import { describe, expect, it } from 'vitest';
import { CaptureNotFoundError, KanbanColumnNotFoundError, KanbanItemNotFoundError } from './errors';
import {
    dropCapture,
    findItem,
    incrementRetry,
    listCaptures,
    moveItem,
    nextBacklogItem,
    promoteCapture,
    updateItem,
} from './mutations';
import type { KanbanBoard } from './types';

const ZERO_RETRIES = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

function boardWithItems(): KanbanBoard {
    return {
        title: 'Board',
        columns: [
            {
                name: 'Backlog',
                captures: [],
                items: [
                    { id: 'b-1', title: 'First', column: 'Backlog', repo: '/tmp/a', body: '', retries: ZERO_RETRIES },
                    { id: 'b-2', title: 'Second', column: 'Backlog', repo: '/tmp/a', body: '', retries: ZERO_RETRIES },
                ],
            },
            { name: 'In Progress', items: [], captures: [] },
            { name: 'Blocked', items: [], captures: [] },
            { name: 'Done', items: [], captures: [] },
        ],
    };
}

describe('nextBacklogItem', () => {
    it('returns the first Backlog item', () => {
        expect(nextBacklogItem(boardWithItems())?.id).toBe('b-1');
    });

    it('returns null when Backlog is empty', () => {
        const b = boardWithItems();
        b.columns[0].items = [];
        expect(nextBacklogItem(b)).toBeNull();
    });
});

describe('moveItem', () => {
    it('moves an item to the target column, appended at the end', () => {
        const b = updateItem(boardWithItems(), 'b-1', {});
        const moved = moveItem(b, 'b-1', 'In Progress');

        expect(moved.columns[0].items.map((i) => i.id)).toEqual(['b-2']);
        expect(moved.columns[1].items.map((i) => i.id)).toEqual(['b-1']);
        expect(moved.columns[1].items[0].column).toBe('In Progress');
    });

    it('does not mutate the original board', () => {
        const b = boardWithItems();
        moveItem(b, 'b-1', 'In Progress');
        expect(b.columns[0].items.map((i) => i.id)).toEqual(['b-1', 'b-2']);
    });

    it('sets blockedReason from note only when moving to Blocked', () => {
        const b = boardWithItems();
        const moved = moveItem(b, 'b-1', 'Blocked', 'failed 3 times');
        expect(findItem(moved, 'b-1').blockedReason).toBe('failed 3 times');

        const movedElsewhere = moveItem(b, 'b-1', 'In Progress', 'should be ignored');
        expect(findItem(movedElsewhere, 'b-1').blockedReason).toBeUndefined();
    });

    it('throws KanbanColumnNotFoundError for an unknown column', () => {
        expect(() => moveItem(boardWithItems(), 'b-1', 'Nonexistent')).toThrow(KanbanColumnNotFoundError);
    });

    it('throws KanbanItemNotFoundError for an unknown id', () => {
        expect(() => moveItem(boardWithItems(), 'missing', 'Done')).toThrow(KanbanItemNotFoundError);
    });
});

describe('updateItem', () => {
    it('merges a partial patch without touching unrelated fields', () => {
        const updated = updateItem(boardWithItems(), 'b-1', { branch: 'feat/x', pr: 12 });
        const item = findItem(updated, 'b-1');

        expect(item.branch).toBe('feat/x');
        expect(item.pr).toBe(12);
        expect(item.title).toBe('First');
    });
});

describe('incrementRetry', () => {
    it('increments only the named gate', () => {
        const b1 = incrementRetry(boardWithItems(), 'b-1', 'ci');
        expect(findItem(b1, 'b-1').retries).toEqual({ ...ZERO_RETRIES, ci: 1 });

        const b2 = incrementRetry(b1, 'b-1', 'ci');
        expect(findItem(b2, 'b-1').retries.ci).toBe(2);
        expect(findItem(b2, 'b-1').retries.e2e_local).toBe(0);
    });
});

describe('capture mutations', () => {
    const boardWithCaptures = (): KanbanBoard => ({
        title: 'Board',
        project: 'demo',
        columns: [
            { name: 'Inbox', items: [], captures: ['- one', '- two', 'three'] },
            { name: 'Backlog', items: [], captures: [] },
        ],
    });

    const FIELDS = { id: 'demo-new', title: 'A promoted item' };

    it('lists captures 1-based in document order', () => {
        expect(listCaptures(boardWithCaptures())).toEqual([
            { index: 1, text: '- one' },
            { index: 2, text: '- two' },
            { index: 3, text: 'three' },
        ]);
    });

    it('promote removes exactly that capture', () => {
        const next = promoteCapture(boardWithCaptures(), 2, FIELDS);
        expect(next.columns[0].captures).toEqual(['- one', 'three']);
    });

    it('promote appends a zeroed-retry item to Backlog by default', () => {
        const next = promoteCapture(boardWithCaptures(), 1, {
            ...FIELDS,
            tags: ['ux', 'P2'],
            body: 'Body.',
        });
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
        const next = promoteCapture(boardWithCaptures(), 1, FIELDS, 'Inbox');
        expect(next.columns[0].items).toHaveLength(1);
    });

    it('promote omits tags when none are given', () => {
        const next = promoteCapture(boardWithCaptures(), 1, FIELDS);
        expect(next.columns[1].items[0].tags).toBeUndefined();
    });

    it('promote rejects a duplicate id without mutating', () => {
        const withItem = boardWithCaptures();
        withItem.columns[1].items.push({
            id: 'demo-new',
            title: 'Existing',
            column: 'Backlog',
            repo: '',
            body: '',
            retries: ZERO_RETRIES,
        });
        expect(() => promoteCapture(withItem, 1, FIELDS)).toThrow(/demo-new/);
        expect(withItem.columns[0].captures).toHaveLength(3);
    });

    it('promote rejects an unknown target column', () => {
        expect(() => promoteCapture(boardWithCaptures(), 1, FIELDS, 'Nope')).toThrow(KanbanColumnNotFoundError);
    });

    it('drop removes one capture and leaves the rest', () => {
        expect(dropCapture(boardWithCaptures(), 3).columns[0].captures).toEqual(['- one', '- two']);
    });

    it('rejects an out-of-range index, naming the valid range', () => {
        expect(() => dropCapture(boardWithCaptures(), 4)).toThrow(CaptureNotFoundError);
        expect(() => dropCapture(boardWithCaptures(), 4)).toThrow(/1-3/);
        expect(() => dropCapture(boardWithCaptures(), 0)).toThrow(CaptureNotFoundError);
    });

    it('explains when the board has no Inbox column', () => {
        const noInbox: KanbanBoard = {
            title: 'Board',
            project: 'demo',
            columns: [{ name: 'Backlog', items: [], captures: [] }],
        };
        expect(() => dropCapture(noInbox, 1)).toThrow(/no '## Inbox'/);
        expect(listCaptures(noInbox)).toEqual([]);
    });

    it('reports an empty Inbox distinctly from an out-of-range index', () => {
        const empty: KanbanBoard = {
            title: 'Board',
            project: 'demo',
            columns: [{ name: 'Inbox', items: [], captures: [] }],
        };
        expect(() => dropCapture(empty, 1)).toThrow(/Inbox is empty/);
    });

    it('does not mutate the input board', () => {
        const original = boardWithCaptures();
        dropCapture(original, 1);
        expect(original.columns[0].captures).toHaveLength(3);
    });

    it('refuses to move an item into Inbox', () => {
        const withItem = boardWithCaptures();
        withItem.columns[1].items.push({
            id: 'demo-1',
            title: 'Existing',
            column: 'Backlog',
            repo: '',
            body: '',
            retries: ZERO_RETRIES,
        });
        expect(() => moveItem(withItem, 'demo-1', 'Inbox')).toThrow(/Inbox/);
    });
});
