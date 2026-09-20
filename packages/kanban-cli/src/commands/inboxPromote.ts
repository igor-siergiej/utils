import { readFileSync } from 'node:fs';
import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { listCaptures, type PromotedItemFields, promoteCapture } from '../kanban/mutations';

export interface InboxPromoteOptions {
    body?: string;
    bodyFile?: string;
    column?: string;
}

export function inboxPromote(
    boardPath: string,
    index: number,
    fields: Omit<PromotedItemFields, 'body'>,
    opts: InboxPromoteOptions = {}
) {
    if (opts.body !== undefined && opts.bodyFile !== undefined) {
        throw new Error('--body and --body-file are mutually exclusive');
    }

    const body = opts.bodyFile ? readFileSync(opts.bodyFile, 'utf8').trimEnd() : opts.body;
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    const text = listCaptures(board).find((capture) => capture.index === index)?.text;

    const next = promoteCapture(board, index, { ...fields, body }, opts.column);
    writeKanbanBoard(boardPath, next);

    const column = opts.column ?? 'Backlog';
    const item = next.columns
        .find((candidate) => candidate.name === column)
        ?.items.find((candidate) => candidate.id === fields.id);

    return { ok: true as const, promoted: { index, text }, item };
}
