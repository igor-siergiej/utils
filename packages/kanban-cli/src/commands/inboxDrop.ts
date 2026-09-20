import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { dropCapture, listCaptures } from '../kanban/mutations';

export function inboxDrop(boardPath: string, index: number, reason?: string) {
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    const text = listCaptures(board).find((capture) => capture.index === index)?.text;

    writeKanbanBoard(boardPath, dropCapture(board, index));

    return {
        ok: true as const,
        dropped: { index, text },
        ...(reason ? { reason } : {}),
    };
}
