import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoResolutionError } from '../repoRegistry/errors';
import { KanbanParseError } from './errors';
import { readKanbanBoard } from './io';

let root: string;
let boardPath: string;
let priorRoots: string | undefined;

beforeEach(() => {
    priorRoots = process.env.KANBAN_CLI_REPO_ROOTS;
    root = mkdtempSync(join(tmpdir(), 'kanban-cli-io-'));
    const repoDir = join(root, 'shoppingo');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, '.kanban-cli.json'), JSON.stringify({ repoName: 'shoppingo' }));
    process.env.KANBAN_CLI_REPO_ROOTS = root;

    boardPath = join(root, 'shoppingo.board.md');
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (priorRoots === undefined) delete process.env.KANBAN_CLI_REPO_ROOTS;
    else process.env.KANBAN_CLI_REPO_ROOTS = priorRoots;
});

const BOARD = `---
project: shoppingo
---

# Shoppingo Board

## Backlog

### First item

- **id:** shoppingo-1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body.

---

## In Progress
## Blocked
## Done
`;

describe('readKanbanBoard', () => {
    it('fills item.repo from the resolved project path', () => {
        writeFileSync(boardPath, BOARD);
        const board = readKanbanBoard(boardPath);
        expect(board.columns[0].items[0].repo).toBe(join(root, 'shoppingo'));
    });

    it('throws when the board has no project frontmatter', () => {
        writeFileSync(boardPath, BOARD.replace('---\nproject: shoppingo\n---\n\n', ''));
        expect(() => readKanbanBoard(boardPath)).toThrow(KanbanParseError);
    });

    it('propagates a resolution failure when the project is unknown', () => {
        writeFileSync(boardPath, BOARD.replace('project: shoppingo', 'project: nonexistent'));
        expect(() => readKanbanBoard(boardPath)).toThrow(/nonexistent/);
    });

    it('throws on whitespace-only project frontmatter', () => {
        writeFileSync(boardPath, BOARD.replace('project: shoppingo', 'project: "   "'));
        expect(() => readKanbanBoard(boardPath)).toThrow(KanbanParseError);
    });

    it('propagates a multi-match RepoResolutionError unchanged', () => {
        const other = join(root, 'shoppingo-worktree');
        mkdirSync(other, { recursive: true });
        writeFileSync(join(other, '.kanban-cli.json'), JSON.stringify({ repoName: 'shoppingo' }));
        writeFileSync(boardPath, BOARD);
        expect(() => readKanbanBoard(boardPath)).toThrow(RepoResolutionError);
    });
});
