import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { findItem, incrementRetry, updateItem } from '../kanban/mutations';
import type { KanbanItem, RetryGate } from '../kanban/types';

export interface KanbanUpdateOptions {
    setBranch?: string;
    setPr?: number;
    setMergedCommit?: string;
    setRevertPr?: number;
    incRetry?: RetryGate;
    complete?: boolean;
}

export function kanbanUpdate(boardPath: string, id: string, options: KanbanUpdateOptions) {
    let board = readKanbanBoard(boardPath);

    const patch: Partial<KanbanItem> = {};
    if (options.setBranch !== undefined) patch.branch = options.setBranch;
    if (options.setPr !== undefined) patch.pr = options.setPr;
    if (options.setMergedCommit !== undefined) patch.mergedCommit = options.setMergedCommit;
    if (options.setRevertPr !== undefined) patch.revertPr = options.setRevertPr;
    if (options.complete) patch.completedAt = new Date().toISOString();

    if (Object.keys(patch).length > 0) {
        board = updateItem(board, id, patch);
    }
    if (options.incRetry) {
        board = incrementRetry(board, id, options.incRetry);
    }

    writeKanbanBoard(boardPath, board);
    return { ok: true as const, item: findItem(board, id) };
}
