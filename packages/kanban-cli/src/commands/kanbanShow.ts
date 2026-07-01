import { KanbanItemNotFoundError } from '../kanban/errors';
import { readKanbanBoard } from '../kanban/io';
import { findItem } from '../kanban/mutations';

export function kanbanShow(boardPath: string, id: string) {
    const board = readKanbanBoard(boardPath);

    try {
        return { ok: true as const, item: findItem(board, id) };
    } catch (cause) {
        if (cause instanceof KanbanItemNotFoundError) return { ok: false as const, error: 'not_found' };
        throw cause;
    }
}
