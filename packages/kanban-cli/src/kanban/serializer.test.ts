import { describe, expect, it } from 'vitest';
import { parseKanbanFile } from './parser';
import { serializeKanbanBoard } from './serializer';
import type { KanbanBoard } from './types';

const ZERO_RETRIES = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

function board(overrides: Partial<KanbanBoard> = {}): KanbanBoard {
    return {
        title: 'Kanban Board',
        columns: [
            { name: 'Backlog', items: [] },
            { name: 'In Progress', items: [] },
            { name: 'Blocked', items: [] },
            { name: 'Done', items: [] },
        ],
        ...overrides,
    };
}

describe('serializeKanbanBoard round-trip', () => {
    it('round-trips a board with no items', () => {
        const b = board();
        expect(parseKanbanFile(serializeKanbanBoard(b))).toEqual(b);
    });

    it('round-trips an item with only required fields', () => {
        const b = board({
            columns: [
                {
                    name: 'Backlog',
                    items: [
                        {
                            id: 'a-1',
                            title: 'Minimal item',
                            column: 'Backlog',
                            repo: '/tmp/repo',
                            body: 'Just a plain body.',
                            retries: ZERO_RETRIES,
                        },
                    ],
                },
                { name: 'In Progress', items: [] },
                { name: 'Blocked', items: [] },
                { name: 'Done', items: [] },
            ],
        });

        expect(parseKanbanFile(serializeKanbanBoard(b))).toEqual(b);
    });

    it('round-trips an item with every optional field populated, including a multi-line body', () => {
        const b = board({
            columns: [
                { name: 'Backlog', items: [] },
                { name: 'In Progress', items: [] },
                {
                    name: 'Blocked',
                    items: [
                        {
                            id: 'blocked-1',
                            title: 'Migrate image upload',
                            column: 'Blocked',
                            repo: '/home/igor/dev/jewellery-catalogue',
                            body: 'Line one.\n\n**Acceptance criteria**\n- Uploads go through the object store\n- Old code path removed',
                            retries: { implement: 3, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 },
                            tags: ['infra', 'storage'],
                            branch: 'migrate/object-store',
                            pr: 94,
                            mergedCommit: undefined,
                            revertPr: undefined,
                            blockedReason: 'Implementation attempted 3 times; upload e2e spec times out only in CI.',
                            completedAt: undefined,
                        },
                    ],
                },
                { name: 'Done', items: [] },
            ],
        });

        expect(parseKanbanFile(serializeKanbanBoard(b))).toEqual(b);
    });

    it('round-trips a Done item with merged_commit and completed_at', () => {
        const b = board({
            columns: [
                { name: 'Backlog', items: [] },
                { name: 'In Progress', items: [] },
                { name: 'Blocked', items: [] },
                {
                    name: 'Done',
                    items: [
                        {
                            id: 'done-1',
                            title: 'Add pagination',
                            column: 'Done',
                            repo: '/home/igor/dev/shoppingo',
                            body: 'Added cursor-based pagination.',
                            retries: ZERO_RETRIES,
                            pr: 121,
                            mergedCommit: '8f2a9c1',
                            completedAt: '2026-06-28T10:15:00.000Z',
                        },
                    ],
                },
            ],
        });

        expect(parseKanbanFile(serializeKanbanBoard(b))).toEqual(b);
    });

    it('is stable across two round trips (parse -> serialize -> parse -> serialize)', () => {
        const b = board({
            columns: [
                {
                    name: 'Backlog',
                    items: [
                        {
                            id: 'stable-1',
                            title: 'Stability check',
                            column: 'Backlog',
                            repo: '/tmp/repo',
                            body: 'Body with a trailing dash line below.\n\n- not a separator',
                            retries: ZERO_RETRIES,
                            tags: ['x'],
                        },
                    ],
                },
                { name: 'In Progress', items: [] },
                { name: 'Blocked', items: [] },
                { name: 'Done', items: [] },
            ],
        });

        const once = serializeKanbanBoard(parseKanbanFile(serializeKanbanBoard(b)));
        const twice = serializeKanbanBoard(parseKanbanFile(once));
        expect(twice).toBe(once);
    });
});
