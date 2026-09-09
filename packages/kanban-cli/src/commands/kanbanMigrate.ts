import { readFileSync, writeFileSync } from 'node:fs';
import { parseKanbanFile } from '../kanban/parser';
import { serializeKanbanBoard } from '../kanban/serializer';

export function kanbanMigrate(
    boardPath: string,
    opts: { project?: string }
): { ok: true; project: string; path: string } {
    const board = parseKanbanFile(readFileSync(boardPath, 'utf8'));
    const project = board.project ?? opts.project;

    if (!project || project.trim() === '') {
        throw new Error('a project name is required: pass --project <name>');
    }

    writeFileSync(boardPath, serializeKanbanBoard({ ...board, project }));
    return { ok: true as const, project, path: boardPath };
}
