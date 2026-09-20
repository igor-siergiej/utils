import { readKanbanBoard } from '../kanban/io';
import { listCaptures } from '../kanban/mutations';

export function inboxList(boardPath: string) {
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    return { ok: true as const, captures: listCaptures(board) };
}
