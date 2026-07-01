import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { findItem, moveItem } from '../kanban/mutations';

export function kanbanMove(boardPath: string, id: string, toColumn: string, note?: string) {
    const board = readKanbanBoard(boardPath);
    const updated = moveItem(board, id, toColumn, note);
    writeKanbanBoard(boardPath, updated);
    return { ok: true as const, item: findItem(updated, id) };
}
