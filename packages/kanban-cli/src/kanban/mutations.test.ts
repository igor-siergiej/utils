import { describe, expect, it } from 'vitest';
import { KanbanColumnNotFoundError, KanbanItemNotFoundError } from './errors';
import { findItem, incrementRetry, moveItem, nextBacklogItem, updateItem } from './mutations';
import type { KanbanBoard } from './types';

const ZERO_RETRIES = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

function boardWithItems(): KanbanBoard {
    return {
        title: 'Board',
        columns: [
            {
                name: 'Backlog',
                items: [
                    { id: 'b-1', title: 'First', column: 'Backlog', repo: '/tmp/a', body: '', retries: ZERO_RETRIES },
                    { id: 'b-2', title: 'Second', column: 'Backlog', repo: '/tmp/a', body: '', retries: ZERO_RETRIES },
                ],
            },
            { name: 'In Progress', items: [] },
            { name: 'Blocked', items: [] },
            { name: 'Done', items: [] },
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
