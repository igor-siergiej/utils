import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runArgv } from '../process/shell';
import { createFakeProcess } from '../testing/fakeProcess';
import { GhCommandError, GhNotFoundError } from './errors';
import { runGh, runGhJson } from './gh';

vi.mock('../process/shell', () => ({ runArgv: vi.fn() }));

let fake: ReturnType<typeof createFakeProcess>;

beforeEach(() => {
    fake = createFakeProcess();
    vi.mocked(runArgv).mockImplementation(fake.run);
});

describe('runGh', () => {
    it('prefixes argv with gh and runs in the given cwd', async () => {
        fake.on(['gh'], { stdout: 'out' });

        await expect(runGh(['pr', 'list'], { cwd: '/repo' })).resolves.toBe('out');
        expect(runArgv).toHaveBeenCalledWith(['gh', 'pr', 'list'], { cwd: '/repo' });
    });

    it('throws GhNotFoundError when gh is not on PATH', async () => {
        fake.on(['gh'], Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));

        await expect(runGh(['pr', 'list'], { cwd: '/repo' })).rejects.toBeInstanceOf(GhNotFoundError);
    });

    it('rethrows other spawn errors unchanged', async () => {
        const cause = Object.assign(new Error('EACCES'), { code: 'EACCES' });
        fake.on(['gh'], cause);

        await expect(runGh(['pr', 'list'], { cwd: '/repo' })).rejects.toBe(cause);
    });

    it('throws GhCommandError carrying stderr on a non-zero exit', async () => {
        fake.on(['gh'], { exitCode: 4, stderr: 'not authenticated\n' });

        const error = await runGh(['pr', 'list'], { cwd: '/repo' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GhCommandError);
        expect((error as Error).message).toBe('gh pr list exited with code 4: not authenticated');
    });
});

describe('runGhJson', () => {
    it('parses stdout as JSON', async () => {
        fake.on(['gh'], { stdout: '{"number":7}' });

        await expect(runGhJson(['pr', 'view'], { cwd: '/repo' })).resolves.toEqual({ number: 7 });
    });
});
