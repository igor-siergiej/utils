import { KanbanColumnNotFoundError, KanbanItemNotFoundError } from './errors';
import type { KanbanBoard, KanbanItem, RetryGate } from './types';

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
