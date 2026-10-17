import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoResolutionError } from '../repoRegistry/errors';
import { REPO_ROOTS_ENV } from '../repoRegistry/resolveRepo';
import { cloneRepo } from './cloneRepo';

// Clones a real local repo over file:// so the git invocation itself is exercised.
let tmp: string;
let roots: string;
let upstream: string;
const savedRoots = process.env[REPO_ROOTS_ENV];

const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });

function makeUpstream(files: Record<string, string>) {
    mkdirSync(upstream);
    git(upstream, 'init', '-q', '-b', 'main');
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(upstream, name), contents);
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-q', '-m', 'init');
}

beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kanban-cli-clone-'));
    roots = join(tmp, 'roots');
    upstream = join(tmp, 'upstream');
    mkdirSync(roots);
    process.env[REPO_ROOTS_ENV] = roots;
});

afterEach(() => {
    if (savedRoots === undefined) delete process.env[REPO_ROOTS_ENV];
    else process.env[REPO_ROOTS_ENV] = savedRoots;
    rmSync(tmp, { recursive: true, force: true });
});

describe('cloneRepo', () => {
    it('clones into the first repo root and writes a minimal config when the repo has none', async () => {
        makeUpstream({ 'README.md': 'hi' });

        const result = await cloneRepo('app', `file://${upstream}`);

        expect(result).toEqual({ ok: true, cloned: true, repo: join(roots, 'app'), configCreated: true });
        expect(readFileSync(join(roots, 'app', 'README.md'), 'utf8')).toBe('hi');
        expect(JSON.parse(readFileSync(join(roots, 'app', '.kanban-cli.json'), 'utf8'))).toEqual({ repoName: 'app' });
    });

    it('is a no-op when the project already resolves', async () => {
        mkdirSync(join(roots, 'existing'));
        writeFileSync(join(roots, 'existing', '.kanban-cli.json'), JSON.stringify({ repoName: 'app' }));

        await expect(cloneRepo('app', 'file:///nowhere')).resolves.toEqual({
            ok: true,
            cloned: false,
            repo: join(roots, 'existing'),
        });
    });

    it('keeps a shipped config whose repoName matches', async () => {
        makeUpstream({ '.kanban-cli.json': JSON.stringify({ repoName: 'app', dev: {} }) });

        const result = await cloneRepo('app', `file://${upstream}`, { root: join(tmp, 'elsewhere') });

        expect(result).toMatchObject({ cloned: true, repo: join(tmp, 'elsewhere', 'app'), configCreated: false });
        expect(JSON.parse(readFileSync(join(tmp, 'elsewhere', 'app', '.kanban-cli.json'), 'utf8')).dev).toEqual({});
    });

    it('rejects a clone whose shipped config names a different project', async () => {
        makeUpstream({ '.kanban-cli.json': JSON.stringify({ repoName: 'other' }) });

        await expect(cloneRepo('app', `file://${upstream}`)).rejects.toThrow(/repoName 'other', not 'app'/);
    });

    it('refuses without a repoUrl', async () => {
        await expect(cloneRepo('app', undefined)).rejects.toBeInstanceOf(RepoResolutionError);
        await expect(cloneRepo('app', undefined)).rejects.toThrow(
            /No local checkout for 'app' and no --url to clone from/
        );
    });

    it('never clones over an existing directory', async () => {
        mkdirSync(join(roots, 'app'));

        await expect(cloneRepo('app', `file://${upstream}`)).rejects.toThrow(/already exists/);
    });

    it('surfaces git clone failures', async () => {
        await expect(cloneRepo('app', `file://${join(tmp, 'missing')}`)).rejects.toThrow(/git clone .* failed/);
        expect(existsSync(join(roots, 'app'))).toBe(false);
    });
});
