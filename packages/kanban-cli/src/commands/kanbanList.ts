import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readKanbanBoard } from '../kanban/io';
import { listColumn } from '../kanban/mutations';

export interface KanbanListOptions {
    kanban?: string;
    allBoards?: string;
}

function boardPaths(options: KanbanListOptions): string[] {
    if (options.allBoards) {
        return readdirSync(options.allBoards)
            .filter((name) => name.endsWith('.board.md'))
            .sort()
            .map((name) => join(options.allBoards as string, name));
    }
    if (options.kanban) return [options.kanban];
    throw new Error('Usage: kanban-cli list --column <name> (--kanban <path> | --all-boards <dir>)');
}

/** Read-only, so one unparseable board is reported in `errors` instead of hiding every other board. */
export function kanbanList(column: string, options: KanbanListOptions) {
    const items = [];
    const errors: Array<{ board: string; error: string }> = [];

    for (const board of boardPaths(options)) {
        try {
            const parsed = readKanbanBoard(board, { requireRepo: false });
            for (const item of listColumn(parsed, column)) {
                items.push({ board, project: parsed.project, ...item });
            }
        } catch (cause) {
            errors.push({ board, error: cause instanceof Error ? cause.message : String(cause) });
        }
    }

    return { ok: true as const, items, errors };
}
