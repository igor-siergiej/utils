import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runArgv } from '../process/shell';
import { createFakeProcess } from '../testing/fakeProcess';
import { revertMergeCommit } from './revert';

vi.mock('../process/shell', () => ({ runArgv: vi.fn() }));

const SHA = '1234567890abcdef';

let fake: ReturnType<typeof createFakeProcess>;

beforeEach(() => {
    fake = createFakeProcess();
    vi.mocked(runArgv).mockImplementation(fake.run);
    fake.on(['git', 'fetch'], {});
    fake.on(['git', 'checkout'], {});
    fake.on(['git', 'revert'], {});
    fake.on(['git', 'push'], {});
    fake.on(['gh', 'pr', 'create'], { stdout: 'https://github.com/o/r/pull/77\n' });
});

const revert = () =>
    revertMergeCommit('/repo', {
        commitSha: SHA,
        base: 'main',
        originalTitle: 'feat: thing',
        originalPrNumber: 50,
        failureSummary: 'smoke: homepage loads failed',
    });

describe('revertMergeCommit', () => {
    it('reverts a squash commit on a fresh branch and opens a PR', async () => {
        fake.on(['git', 'rev-list'], { stdout: `${SHA} parent1\n` });

        const pr = await revert();

        expect(pr).toEqual({ number: 77, url: 'https://github.com/o/r/pull/77' });
        expect(fake.calls.map((argv) => argv.slice(0, 3).join(' '))).toEqual([
            'git fetch origin',
            'git checkout -B',
            'git rev-list --parents',
            'git revert --no-edit',
            'git push -u',
            'gh pr create',
        ]);
        expect(fake.calls[1]).toEqual(['git', 'checkout', '-B', 'revert/1234567', 'origin/main']);
        expect(fake.calls[3]).toEqual(['git', 'revert', '--no-edit', SHA]);
    });

    it('reverts against the first parent for a true merge commit', async () => {
        fake.on(['git', 'rev-list'], { stdout: `${SHA} parent1 parent2\n` });

        await revert();

        expect(fake.calls[3]).toEqual(['git', 'revert', '--no-edit', '-m', '1', SHA]);
    });

    it('titles the PR after the original and explains why in the body', async () => {
        fake.on(['git', 'rev-list'], { stdout: `${SHA} parent1\n` });

        await revert();

        const create = fake.calls[5];
        expect(create[create.indexOf('--title') + 1]).toBe('Revert: feat: thing');
        expect(create[create.indexOf('--head') + 1]).toBe('revert/1234567');
        const body = create[create.indexOf('--body') + 1];
        expect(body).toContain(`Automated revert of ${SHA} (#50).`);
        expect(body).toContain('smoke: homepage loads failed');
    });
});
