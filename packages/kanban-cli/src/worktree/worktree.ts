import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runArgv } from '../process/shell';

export interface Worktree {
    path: string;
    branch: string;
    created: boolean;
}

export const WORKTREES_DIR = '.worktrees';

export function worktreePath(repo: string, project: string, n: number): string {
    return join(repo, WORKTREES_DIR, `${project}-${n}`);
}

export function worktreeBranch(project: string, n: number): string {
    return `factory/${project}-${n}`;
}

async function git(repo: string, args: string[]): Promise<string> {
    const result = await runArgv(['git', ...args], { cwd: repo });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
}

/** Base for a new branch: the remote default branch when there is one, else local HEAD. */
async function baseRef(repo: string): Promise<string> {
    const remote = await runArgv(['git', 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: repo });
    if (remote.exitCode === 0) {
        await runArgv(['git', 'fetch', '--quiet', 'origin'], { cwd: repo });
        return remote.stdout.trim().replace('refs/remotes/', '');
    }
    return 'HEAD';
}

/** `.worktrees/` must never show up as untracked in the user's own checkout. */
async function excludeWorktreesDir(repo: string): Promise<void> {
    const ignored = await runArgv(['git', 'check-ignore', '-q', `${WORKTREES_DIR}/`], { cwd: repo });
    if (ignored.exitCode === 0) return;
    const exclude = join(await git(repo, ['rev-parse', '--absolute-git-dir']), 'info', 'exclude');
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    appendFileSync(exclude, `${current === '' || current.endsWith('\n') ? '' : '\n'}${WORKTREES_DIR}/\n`);
}

export async function ensureWorktree(repo: string, project: string, n: number): Promise<Worktree> {
    const path = worktreePath(repo, project, n);
    const branch = worktreeBranch(project, n);
    if (existsSync(path)) return { path, branch, created: false };

    await excludeWorktreesDir(repo);
    const hasBranch = (await git(repo, ['branch', '--list', branch])) !== '';
    await git(
        repo,
        hasBranch ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, await baseRef(repo)]
    );
    return { path, branch, created: true };
}

export async function removeWorktree(repo: string, project: string, n: number): Promise<void> {
    const path = worktreePath(repo, project, n);
    if (existsSync(path)) await git(repo, ['worktree', 'remove', '--force', path]);
    await runArgv(['git', 'branch', '-D', worktreeBranch(project, n)], { cwd: repo });
}

/** Copies the git-ignored `.env*` files a fresh worktree lacks, then installs dependencies. */
export async function prepareWorktree(repo: string, path: string, options: { install?: boolean } = {}): Promise<void> {
    for (const name of readdirSync(repo).filter((f) => f.startsWith('.env'))) {
        const ignored = await runArgv(['git', 'check-ignore', '-q', name], { cwd: repo });
        if (ignored.exitCode === 0 && !existsSync(join(path, name))) copyFileSync(join(repo, name), join(path, name));
    }
    if (options.install === false) return;
    if (existsSync(join(path, 'bun.lock'))) await runArgv(['bun', 'install', '--frozen-lockfile'], { cwd: path });
    else if (existsSync(join(path, 'Cargo.toml'))) await runArgv(['cargo', 'fetch'], { cwd: path });
}
