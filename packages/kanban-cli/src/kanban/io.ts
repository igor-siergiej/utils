import { readFileSync, writeFileSync } from 'node:fs';
import { resolveRepoPath } from '../repoRegistry/resolveRepo';
import { KanbanParseError } from './errors';
import { parseKanbanFile } from './parser';
import { serializeKanbanBoard } from './serializer';
import type { KanbanBoard } from './types';

export function readKanbanBoard(path: string): KanbanBoard {
    const board = parseKanbanFile(readFileSync(path, 'utf8'));

    if (!board.project || board.project.trim() === '') {
        throw new KanbanParseError("Board file is missing its 'project' frontmatter (--- project: <name> ---)");
    }

    const repo = resolveRepoPath(board.project);

    return {
        ...board,
        columns: board.columns.map((column) => ({
            ...column,
            items: column.items.map((item) => ({ ...item, repo })),
        })),
    };
}

export function writeKanbanBoard(path: string, board: KanbanBoard): void {
    writeFileSync(path, serializeKanbanBoard(board));
}
