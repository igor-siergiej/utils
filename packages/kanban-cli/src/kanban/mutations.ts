import {
    CaptureNotFoundError,
    InboxNotAWorkColumnError,
    KanbanColumnNotFoundError,
    KanbanItemNotFoundError,
    KanbanParseError,
} from './errors';
import type { KanbanBoard, KanbanItem, RetryGate } from './types';
import { INBOX_COLUMN } from './types';

function locateItem(board: KanbanBoard, id: string): { columnIndex: number; itemIndex: number } {
    for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex += 1) {
        const itemIndex = board.columns[columnIndex].items.findIndex((item) => item.id === id);
        if (itemIndex !== -1) return { columnIndex, itemIndex };
    }
    throw new KanbanItemNotFoundError(id);
}

export function findItem(board: KanbanBoard, id: string): KanbanItem {
    const { columnIndex, itemIndex } = locateItem(board, id);
    return board.columns[columnIndex].items[itemIndex];
}

export function nextBacklogItem(board: KanbanBoard, backlogColumn = 'Backlog'): KanbanItem | null {
    const column = board.columns.find((c) => c.name === backlogColumn);
    return column?.items[0] ?? null;
}

function cloneColumns(board: KanbanBoard) {
    return board.columns.map((column) => ({ ...column, items: [...column.items] }));
}

export function moveItem(board: KanbanBoard, id: string, toColumn: string, note?: string): KanbanBoard {
    if (toColumn === INBOX_COLUMN) throw new InboxNotAWorkColumnError(INBOX_COLUMN);

    const targetColumnIndex = board.columns.findIndex((c) => c.name === toColumn);
    if (targetColumnIndex === -1) throw new KanbanColumnNotFoundError(toColumn);

    const { columnIndex, itemIndex } = locateItem(board, id);
    const columns = cloneColumns(board);
    const [item] = columns[columnIndex].items.splice(itemIndex, 1);

    const updated: KanbanItem = { ...item, column: toColumn };
    if (note && toColumn === 'Blocked') {
        updated.blockedReason = note;
    }

    columns[targetColumnIndex].items.push(updated);

    return { ...board, columns };
}

export function updateItem(board: KanbanBoard, id: string, patch: Partial<KanbanItem>): KanbanBoard {
    const { columnIndex, itemIndex } = locateItem(board, id);
    const columns = cloneColumns(board);
    columns[columnIndex].items[itemIndex] = { ...columns[columnIndex].items[itemIndex], ...patch };
    return { ...board, columns };
}

export function incrementRetry(board: KanbanBoard, id: string, gate: RetryGate): KanbanBoard {
    const item = findItem(board, id);
    return updateItem(board, id, { retries: { ...item.retries, [gate]: item.retries[gate] + 1 } });
}

export interface PromotedItemFields {
    id: string;
    title: string;
    tags?: string[];
    body?: string;
}

export function listCaptures(board: KanbanBoard): Array<{ index: number; text: string }> {
    const column = board.columns.find((c) => c.name === INBOX_COLUMN);
    return (column?.captures ?? []).map((text, i) => ({ index: i + 1, text }));
}

function takeCapture(board: KanbanBoard, index: number): { text: string; columns: KanbanBoard['columns'] } {
    const columnIndex = board.columns.findIndex((c) => c.name === INBOX_COLUMN);
    if (columnIndex === -1) {
        throw new CaptureNotFoundError(`this board has no '## ${INBOX_COLUMN}' section, so it holds no captures`);
    }

    const captures = board.columns[columnIndex].captures;

    if (!Number.isInteger(index) || index < 1 || index > captures.length) {
        throw new CaptureNotFoundError(
            captures.length
                ? `no capture at index ${index}; valid range is 1-${captures.length}`
                : `no capture at index ${index}; the ${INBOX_COLUMN} is empty`
        );
    }

    return {
        text: captures[index - 1],
        columns: board.columns.map((column, i) =>
            i === columnIndex ? { ...column, captures: captures.filter((_, c) => c !== index - 1) } : column
        ),
    };
}

export function dropCapture(board: KanbanBoard, index: number): KanbanBoard {
    return { ...board, columns: takeCapture(board, index).columns };
}

export function promoteCapture(
    board: KanbanBoard,
    index: number,
    fields: PromotedItemFields,
    toColumn = 'Backlog'
): KanbanBoard {
    const targetIndex = board.columns.findIndex((c) => c.name === toColumn);
    if (targetIndex === -1) throw new KanbanColumnNotFoundError(toColumn);

    if (board.columns.some((c) => c.items.some((item) => item.id === fields.id))) {
        throw new KanbanParseError(`Duplicate item id '${fields.id}'`);
    }

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
            i === targetIndex ? { ...column, items: [...column.items, item] } : column
        ),
    };
}
