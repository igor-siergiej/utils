import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RepoResolutionError } from '../repoRegistry/errors';
import { resolveRepoPath } from '../repoRegistry/resolveRepo';
import { KanbanParseError } from './errors';
import { parseKanbanFile } from './parser';
import { serializeKanbanBoard } from './serializer';
import type { KanbanBoard } from './types';

export interface ReadKanbanBoardOptions {
    /**
     * Resolve the board's `project` to a local checkout and stamp it on every
     * item. Default `true`. Pass `false` for commands that only touch the board
     * file itself — a project with no clone (e.g. an archived repo) would
     * otherwise make even a read-only command fail.
     */
    requireRepo?: boolean;
}

export function readKanbanBoard(path: string, opts: ReadKanbanBoardOptions = {}): KanbanBoard {
    const requireRepo = opts.requireRepo ?? true;
    const board = parseKanbanFile(readFileSync(path, 'utf8'));

    if (!board.project || board.project.trim() === '') {
        throw new KanbanParseError("Board file is missing its 'project' frontmatter (--- project: <name> ---)");
    }

    let repo = '';
    try {
        repo = resolveRepoPath(board.project);
    } catch (cause) {
        if (requireRepo || !(cause instanceof RepoResolutionError)) throw cause;
    }

    return {
        ...board,
        columns: board.columns.map((column) => ({
            ...column,
            items: column.items.map((item) => ({ ...item, repo })),
        })),
    };
}

/**
 * Write via a sibling temp file and rename. The board commonly lives on a
 * synced mount and is edited from a phone, so a half-written file must never be
 * observable; rename also lets us replace a board file owned by another user
 * (the sync daemon runs as root) as long as its directory is writable.
 */
export function writeKanbanBoard(path: string, board: KanbanBoard): void {
    const temp = join(dirname(path), `.${basename(path)}.tmp`);
    try {
        writeFileSync(temp, serializeKanbanBoard(board));
        renameSync(temp, path);
    } catch (cause) {
        try {
            unlinkSync(temp);
        } catch {
            // The temp file may never have been created; the original error is what matters.
        }
        throw cause;
    }
}
