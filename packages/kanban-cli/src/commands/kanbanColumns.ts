import { readKanbanBoard } from '../kanban/io';

export function kanbanColumns(boardPath: string) {
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    return { ok: true as const, columns: board.columns.map((column) => column.name) };
}
