import { type BoardSelection, boardPaths } from '../kanban/boardPaths';
import { readKanbanBoard } from '../kanban/io';
import { listCaptures, listColumn } from '../kanban/mutations';
import type { KanbanBoard, KanbanItem } from '../kanban/types';
import { INBOX_COLUMN } from '../kanban/types';

export interface KanbanListOptions extends BoardSelection {
    /** One column; omitted means every open column (all but Inbox and Done). */
    column?: string;
    project?: string;
    tag?: string;
}

const USAGE =
    'Usage: kanban-cli list [--column <name>] [--project <name>] [--tag <tag>] (--kanban <path> | --all-boards <dir>)';

function openColumns(board: KanbanBoard): string[] {
    return board.columns.map((c) => c.name).filter((name) => name !== INBOX_COLUMN && name !== 'Done');
}

function hasTag(item: KanbanItem, tag: string): boolean {
    const wanted = tag.toLowerCase();
    return (item.tags ?? []).some((t) => t.toLowerCase() === wanted);
}

/** Read-only, so one unparseable board is reported in `errors` instead of hiding every other board. */
export function kanbanList(options: KanbanListOptions) {
    const items = [];
    const boards = [];
    const errors: Array<{ board: string; error: string }> = [];

    for (const board of boardPaths(options, USAGE)) {
        try {
            const parsed = readKanbanBoard(board, { requireRepo: false });
            if (options.project && parsed.project !== options.project) continue;

            const columns = options.column ? [options.column] : openColumns(parsed);
            const counts: Record<string, number> = {};

            for (const column of columns) {
                const matching = listColumn(parsed, column).filter((item) => !options.tag || hasTag(item, options.tag));
                counts[column] = matching.length;
                for (const item of matching) items.push({ board, project: parsed.project, ...item });
            }

            boards.push({ board, project: parsed.project, counts, inbox: listCaptures(parsed).length });
        } catch (cause) {
            errors.push({ board, error: cause instanceof Error ? cause.message : String(cause) });
        }
    }

    return { ok: true as const, items, boards, errors };
}
