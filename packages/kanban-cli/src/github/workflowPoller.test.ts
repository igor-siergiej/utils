import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runArgv } from '../process/shell';
import { createFakeProcess, json } from '../testing/fakeProcess';
import { waitForWorkflowRun } from './workflowPoller';

vi.mock('../process/shell', () => ({ runArgv: vi.fn() }));

let fake: ReturnType<typeof createFakeProcess>;

beforeEach(() => {
    fake = createFakeProcess();
    vi.mocked(runArgv).mockImplementation(fake.run);
});

const run = (headSha: string, status: string, conclusion: string | null) => ({
    headSha,
    status,
    conclusion,
    url: `https://github.com/o/r/actions/runs/${headSha}`,
});

const wait = (timeoutMs = 1000) => waitForWorkflowRun('/repo', 'Deploy', 'abc', { timeoutMs, intervalMs: 1 });

describe('waitForWorkflowRun', () => {
    it('queries the named workflow', async () => {
        fake.on(['gh', 'run', 'list'], json([run('abc', 'completed', 'success')]));

        await wait();

        expect(fake.calls[0]).toEqual([
            'gh',
            'run',
            'list',
            '--workflow',
            'Deploy',
            '--json',
            'headSha,status,conclusion,url',
            '--limit',
            '20',
        ]);
    });

    it('keeps polling until the run for the commit completes, ignoring other commits', async () => {
        fake.on(
            ['gh', 'run', 'list'],
            json([run('other', 'completed', 'success')]),
            json([run('abc', 'in_progress', null), run('other', 'completed', 'success')]),
            json([run('abc', 'completed', 'success')])
        );

        const result = await wait();

        expect(result).toEqual({ status: 'success', runUrl: 'https://github.com/o/r/actions/runs/abc' });
        expect(fake.calls).toHaveLength(3);
    });

    it.each(['failure', 'cancelled', null])('reports failure for conclusion %s', async (conclusion) => {
        fake.on(['gh', 'run', 'list'], json([run('abc', 'completed', conclusion)]));

        await expect(wait()).resolves.toMatchObject({ status: 'failure' });
    });

    it('times out when the run never completes', async () => {
        fake.on(['gh', 'run', 'list'], json([run('abc', 'queued', null)]));

        await expect(wait(0)).resolves.toEqual({ status: 'timeout' });
    });
});
