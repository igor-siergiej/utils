import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runArgv } from '../process/shell';
import { createFakeProcess, json } from '../testing/fakeProcess';
import { summarizeChecks, waitForChecks } from './checks';

vi.mock('../process/shell', () => ({ runArgv: vi.fn() }));

const checkRun = (name: string, status: string, conclusion: string | null) => ({
    __typename: 'CheckRun',
    name,
    status,
    conclusion,
});

const statusContext = (context: string, state: string) => ({
    __typename: 'StatusContext',
    context,
    state,
});

describe('summarizeChecks', () => {
    it('stays pending while any check run is still queued or running', () => {
        const snapshot = summarizeChecks([
            checkRun('lint', 'COMPLETED', 'SUCCESS'),
            checkRun('e2e', 'IN_PROGRESS', null),
        ]);

        expect(snapshot.status).toBe('pending');
    });

    it('succeeds once every check run has a passing conclusion', () => {
        const snapshot = summarizeChecks([
            checkRun('lint', 'COMPLETED', 'SUCCESS'),
            checkRun('flaky-optional', 'COMPLETED', 'SKIPPED'),
            checkRun('advisory', 'COMPLETED', 'NEUTRAL'),
        ]);

        expect(snapshot.status).toBe('success');
        expect(snapshot.checks.map((check) => check.name)).toEqual(['lint', 'flaky-optional', 'advisory']);
    });

    it('fails as soon as one check run failed, even with others still running', () => {
        const snapshot = summarizeChecks([checkRun('test', 'COMPLETED', 'FAILURE'), checkRun('e2e', 'QUEUED', null)]);

        expect(snapshot.status).toBe('failure');
    });

    it('treats a cancelled check run as a failure', () => {
        expect(summarizeChecks([checkRun('e2e', 'COMPLETED', 'CANCELLED')]).status).toBe('failure');
    });

    it('reads external commit statuses, which carry context/state instead of name/conclusion', () => {
        expect(summarizeChecks([statusContext('ci/external', 'PENDING')]).status).toBe('pending');
        expect(summarizeChecks([statusContext('ci/external', 'SUCCESS')]).status).toBe('success');
        expect(summarizeChecks([statusContext('ci/external', 'ERROR')]).status).toBe('failure');
        expect(summarizeChecks([statusContext('ci/external', 'SUCCESS')]).checks[0].name).toBe('ci/external');
    });

    it('stays pending when the PR has no checks at all', () => {
        expect(summarizeChecks([]).status).toBe('pending');
    });

    it('ignores checks outside requiredNames, including failing ones', () => {
        const entries = [checkRun('lint', 'COMPLETED', 'SUCCESS'), checkRun('optional-scan', 'COMPLETED', 'FAILURE')];

        const snapshot = summarizeChecks(entries, ['lint']);

        expect(snapshot.status).toBe('success');
        expect(snapshot.checks).toEqual([{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
    });

    it('stays pending until every required check has been reported', () => {
        const reportedSoFar = [checkRun('lint', 'COMPLETED', 'SUCCESS')];

        expect(summarizeChecks(reportedSoFar, ['lint', 'deploy-preview']).status).toBe('pending');
        expect(
            summarizeChecks(
                [...reportedSoFar, checkRun('deploy-preview', 'COMPLETED', 'SUCCESS')],
                ['lint', 'deploy-preview']
            ).status
        ).toBe('success');
    });

    it('still fails fast when a reported required check failed and another is missing', () => {
        const snapshot = summarizeChecks([checkRun('lint', 'COMPLETED', 'FAILURE')], ['lint', 'deploy-preview']);

        expect(snapshot.status).toBe('failure');
    });
});

describe('waitForChecks', () => {
    let fake: ReturnType<typeof createFakeProcess>;

    beforeEach(() => {
        fake = createFakeProcess();
        vi.mocked(runArgv).mockImplementation(fake.run);
    });

    const rollup = (...entries: unknown[]) => json({ statusCheckRollup: entries });

    it('reads the rollup via gh pr view rather than gh pr checks --json', async () => {
        fake.on(['gh', 'pr', 'view'], rollup(checkRun('lint', 'COMPLETED', 'SUCCESS')));

        await waitForChecks('/repo', 5, { timeoutMs: 1000, intervalMs: 1 });

        expect(fake.calls[0]).toEqual(['gh', 'pr', 'view', '5', '--json', 'statusCheckRollup']);
    });

    it('polls through pending snapshots until a terminal verdict', async () => {
        fake.on(
            ['gh', 'pr', 'view'],
            json({ statusCheckRollup: null }),
            rollup(checkRun('lint', 'IN_PROGRESS', null)),
            rollup(checkRun('lint', 'COMPLETED', 'FAILURE'))
        );

        const result = await waitForChecks('/repo', 5, { timeoutMs: 1000, intervalMs: 1 });

        expect(result).toEqual({
            status: 'failure',
            checks: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }],
        });
        expect(fake.calls).toHaveLength(3);
    });

    it('passes required names through to the verdict', async () => {
        fake.on(
            ['gh', 'pr', 'view'],
            rollup(checkRun('lint', 'COMPLETED', 'SUCCESS'), checkRun('optional', 'COMPLETED', 'FAILURE'))
        );

        const result = await waitForChecks('/repo', 5, { timeoutMs: 1000, intervalMs: 1, requiredNames: ['lint'] });

        expect(result.status).toBe('success');
    });

    it('times out with no checks when still pending at the deadline', async () => {
        fake.on(['gh', 'pr', 'view'], rollup(checkRun('lint', 'QUEUED', null)));

        await expect(waitForChecks('/repo', 5, { timeoutMs: 0, intervalMs: 1 })).resolves.toEqual({
            status: 'timeout',
            checks: [],
        });
    });
});
