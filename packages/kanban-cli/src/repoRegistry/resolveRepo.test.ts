import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoResolutionError } from './errors';
import { repoRoots, resolveRepoPath } from './resolveRepo';

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kanban-cli-registry-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function makeRepo(dir: string, repoName: string) {
    const path = join(root, dir);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, '.kanban-cli.json'), JSON.stringify({ repoName }));
    return path;
}

describe('repoRoots', () => {
    it('splits the env var on colons', () => {
        expect(repoRoots({ KANBAN_CLI_REPO_ROOTS: '/a:/b:/c' })).toEqual(['/a', '/b', '/c']);
    });

    it('falls back to the home directory when unset', () => {
        const roots = repoRoots({});
        expect(roots).toHaveLength(1);
        expect(roots[0]).toBeTruthy();
    });
});

describe('resolveRepoPath', () => {
    it('returns the directory whose .kanban-cli.json repoName matches', () => {
        const expected = makeRepo('shoppingo', 'shoppingo');
        makeRepo('kivo', 'kivo');
        expect(resolveRepoPath('shoppingo', [root])).toBe(expected);
    });

    it('ignores repos whose repoName does not match', () => {
        makeRepo('other', 'not-it');
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(RepoResolutionError);
    });

    it('names the project and roots in the no-match error', () => {
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(/shoppingo/);
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(new RegExp(root.replace(/[/\\]/g, '\\$&')));
    });

    it('throws when more than one repo claims the project', () => {
        makeRepo('a', 'shoppingo');
        makeRepo('b', 'shoppingo');
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(/more than one/i);
    });

    it('skips roots that do not exist', () => {
        const expected = makeRepo('shoppingo', 'shoppingo');
        expect(resolveRepoPath('shoppingo', [join(root, 'nope'), root])).toBe(expected);
    });

    it('matches a repo two levels below the root', () => {
        const path = join(root, 'imapps', 'shoppingo');
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, '.kanban-cli.json'), JSON.stringify({ repoName: 'shoppingo' }));
        expect(resolveRepoPath('shoppingo', [root])).toBe(path);
    });

    it('ignores a malformed .kanban-cli.json in the scan path', () => {
        const bad = join(root, 'broken');
        mkdirSync(bad, { recursive: true });
        writeFileSync(join(bad, '.kanban-cli.json'), '{ not json');
        const expected = makeRepo('shoppingo', 'shoppingo');
        expect(resolveRepoPath('shoppingo', [root])).toBe(expected);
    });

    it('skips a root path that is a file, not a directory', () => {
        const filePath = join(root, 'a-file');
        writeFileSync(filePath, 'hi');
        const expected = makeRepo('shoppingo', 'shoppingo');
        expect(resolveRepoPath('shoppingo', [filePath, root])).toBe(expected);
    });

    it('names the two-level scan depth in the no-match error', () => {
        expect(() => resolveRepoPath('shoppingo', [root])).toThrow(/scanned up to two levels deep/);
    });
});
