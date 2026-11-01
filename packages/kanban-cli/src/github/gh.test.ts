import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { RunArgv } from '../process/shell';
import { createFakeProcess } from '../testing/fakeProcess';
import { GhCommandError, GhNotFoundError } from './errors';
import { runGh, runGhJson } from './gh';

let fake: ReturnType<typeof createFakeProcess>;

const run: RunArgv = (argv, options) => fake.run(argv, options);

beforeEach(() => {
    fake = createFakeProcess();
});

describe('runGh', () => {
    it('prefixes argv with gh and runs in the given cwd', async () => {
        fake.on(['gh'], { stdout: 'out' });

        await expect(runGh(['pr', 'list'], { cwd: '/repo', run })).resolves.toBe('out');
        expect(fake.calls).toEqual([['gh', 'pr', 'list']]);
        expect(fake.cwds).toEqual(fake.calls.map(() => '/repo'));
    });

    it('throws GhNotFoundError when gh is not on PATH', async () => {
        fake.on(['gh'], Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));

        await expect(runGh(['pr', 'list'], { cwd: '/repo', run })).rejects.toBeInstanceOf(GhNotFoundError);
    });

    it('rethrows other spawn errors unchanged', async () => {
        const cause = Object.assign(new Error('EACCES'), { code: 'EACCES' });
        fake.on(['gh'], cause);

        await expect(runGh(['pr', 'list'], { cwd: '/repo', run })).rejects.toBe(cause);
    });

    it('throws GhCommandError carrying stderr on a non-zero exit', async () => {
        fake.on(['gh'], { exitCode: 4, stderr: 'not authenticated\n' });

        const failed = runGh(['pr', 'list'], { cwd: '/repo', run });

        await expect(failed).rejects.toBeInstanceOf(GhCommandError);
        await expect(failed).rejects.toThrow('gh pr list exited with code 4: not authenticated');
    });
});

describe('runGhJson', () => {
    it('parses stdout as JSON', async () => {
        fake.on(['gh'], { stdout: '{"number":7}' });

        await expect(
            runGhJson(['pr', 'view'], { cwd: '/repo', run }, z.object({ number: z.number() }))
        ).resolves.toEqual({ number: 7 });
    });

    it('rejects output of another shape', async () => {
        fake.on(['gh'], { stdout: '{"number":"seven"}' });

        await expect(
            runGhJson(['pr', 'view'], { cwd: '/repo', run }, z.object({ number: z.number() }))
        ).rejects.toThrow(/unexpected JSON/);
    });
});
