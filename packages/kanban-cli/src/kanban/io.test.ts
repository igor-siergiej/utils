import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoResolutionError } from '../repoRegistry/errors';
import { KanbanParseError } from './errors';
import { readKanbanBoard, writeKanbanBoard } from './io';
import { dropCapture } from './mutations';

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

describe('readKanbanBoard — requireRepo', () => {
    const INBOX_BOARD = `---
project: nonexistent
---

# Board

## Inbox

- a capture

## Backlog
`;

    it('throws by default when the project has no checkout', () => {
        writeFileSync(boardPath, INBOX_BOARD);
        expect(() => readKanbanBoard(boardPath)).toThrow(RepoResolutionError);
    });

    it('returns the board with an empty repo when requireRepo is false', () => {
        writeFileSync(boardPath, BOARD.replace('project: shoppingo', 'project: nonexistent'));
        const board = readKanbanBoard(boardPath, { requireRepo: false });
        expect(board.columns[0].items[0].repo).toBe('');
    });

    it('still reads captures with requireRepo false', () => {
        writeFileSync(boardPath, INBOX_BOARD);
        const board = readKanbanBoard(boardPath, { requireRepo: false });
        expect(board.columns[0].captures).toEqual(['- a capture']);
    });

    it('still resolves the repo with requireRepo false when the project does exist', () => {
        writeFileSync(boardPath, BOARD);
        const board = readKanbanBoard(boardPath, { requireRepo: false });
        expect(board.columns[0].items[0].repo).toBe(join(root, 'shoppingo'));
    });

    it('does not swallow a parse error when requireRepo is false', () => {
        writeFileSync(boardPath, BOARD.replace('---\nproject: shoppingo\n---\n\n', ''));
        expect(() => readKanbanBoard(boardPath, { requireRepo: false })).toThrow(KanbanParseError);
    });
});

describe('writeKanbanBoard — durable writes', () => {
    it('leaves no temp file behind', () => {
        writeFileSync(boardPath, BOARD);
        const board = readKanbanBoard(boardPath);
        writeKanbanBoard(boardPath, board);

        const siblings = readdirSync(dirname(boardPath)).filter(
            (name) => name !== basename(boardPath) && name !== 'shoppingo'
        );
        expect(siblings).toEqual([]);
    });

    it('updates a board file the user cannot open for writing', () => {
        writeFileSync(
            boardPath,
            `---
project: shoppingo
---

# Board

## Inbox

- a capture

## Backlog
`
        );
        chmodSync(boardPath, 0o444);

        const board = readKanbanBoard(boardPath);
        writeKanbanBoard(boardPath, dropCapture(board, 1));

        expect(readFileSync(boardPath, 'utf8')).not.toContain('a capture');
    });
});
