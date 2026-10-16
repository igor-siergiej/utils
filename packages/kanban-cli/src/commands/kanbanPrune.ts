import { type BoardSelection, boardPaths } from '../kanban/boardPaths';
import { readKanbanBoard, writeKanbanBoard } from '../kanban/io';
import { clearColumn } from '../kanban/mutations';

const USAGE = 'Usage: kanban-cli prune [--column <name>] (--kanban <path> | --all-boards <dir>)';

/** Deletes every item in `column` (default Done). Boards with nothing to prune are left untouched on disk. */
export function kanbanPrune(selection: BoardSelection, column = 'Done') {
    const pruned = [];
    const errors: Array<{ board: string; error: string }> = [];

    for (const board of boardPaths(selection, USAGE)) {
        try {
            const parsed = readKanbanBoard(board, { requireRepo: false });
            const { board: cleared, removed } = clearColumn(parsed, column);
            if (removed.length === 0) continue;

            writeKanbanBoard(board, cleared);
            pruned.push({ board, project: parsed.project, ids: removed.map((item) => item.id) });
        } catch (cause) {
            errors.push({ board, error: cause instanceof Error ? cause.message : String(cause) });
        }
    }

    return { ok: true as const, pruned, errors };
}
