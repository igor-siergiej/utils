import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureWorktree, prepareWorktree, removeWorktree, worktreePath } from './worktree';

let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'kanban-cli-worktree-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    writeFileSync(join(repo, '.gitignore'), '.env\n');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
});

afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
});

describe('worktrees', () => {
    it('creates a worktree on a factory branch from main, and reuses it after', async () => {
        const first = await ensureWorktree(repo, 'tandra', 42);

        expect(first).toEqual({ path: worktreePath(repo, 'tandra', 42), branch: 'factory/tandra-42', created: true });
        expect(readFileSync(join(first.path, 'a.txt'), 'utf8')).toBe('a');
        expect(git('-C', first.path, 'branch', '--show-current')).toBe('factory/tandra-42');
        expect(await ensureWorktree(repo, 'tandra', 42)).toMatchObject({ created: false });
    });

    it('keeps .worktrees out of the main checkout status', async () => {
        await ensureWorktree(repo, 'tandra', 1);

        expect(git('status', '--porcelain')).toBe('');
    });

    it('copies ignored .env files from the main checkout', async () => {
        writeFileSync(join(repo, '.env'), 'SECRET=1');
        const { path } = await ensureWorktree(repo, 'tandra', 2);

        await prepareWorktree(repo, path, { install: false });

        expect(readFileSync(join(path, '.env'), 'utf8')).toBe('SECRET=1');
    });

    it('removes the worktree and its branch', async () => {
        const { path } = await ensureWorktree(repo, 'tandra', 3);

        await removeWorktree(repo, 'tandra', 3);

        expect(existsSync(path)).toBe(false);
        expect(git('branch', '--list', 'factory/tandra-3')).toBe('');
    });

    it('gives a refine its own worktree and branch, so it never reads a build leftovers', async () => {
        const build = await ensureWorktree(repo, 'tandra', 5);
        const refine = await ensureWorktree(repo, 'tandra', 5, 'refine');

        expect(refine.path).not.toBe(build.path);
        expect(refine.branch).toBe('factory/tandra-5-refine');
        expect(git('-C', refine.path, 'branch', '--show-current')).toBe('factory/tandra-5-refine');
    });
});
