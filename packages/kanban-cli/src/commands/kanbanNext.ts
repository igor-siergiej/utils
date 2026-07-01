import { readKanbanBoard } from '../kanban/io';
import { nextBacklogItem } from '../kanban/mutations';

export function kanbanNext(boardPath: string) {
    const board = readKanbanBoard(boardPath);
    return { ok: true as const, item: nextBacklogItem(board) };
}
