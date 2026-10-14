import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runArgv } from '../process/shell';
import { createFakeProcess, json } from '../testing/fakeProcess';
import { createPullRequest, getPullRequestStatus, mergePullRequest, parseCreatedPrOutput } from './pullRequest';

vi.mock('../process/shell', () => ({ runArgv: vi.fn() }));

let fake: ReturnType<typeof createFakeProcess>;

beforeEach(() => {
    fake = createFakeProcess();
    vi.mocked(runArgv).mockImplementation(fake.run);
});

const prView = (overrides: Record<string, unknown> = {}) =>
    json({
        number: 12,
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        statusCheckRollup: [],
        reviewDecision: null,
        mergeCommit: null,
        ...overrides,
    });

describe('parseCreatedPrOutput', () => {
    it('takes the PR number from the last line of gh output', () => {
        expect(parseCreatedPrOutput('Warning: 1 uncommitted change\nhttps://github.com/o/r/pull/42\n')).toEqual({
            number: 42,
            url: 'https://github.com/o/r/pull/42',
        });
    });

    it('returns NaN when no PR url is present', () => {
        expect(parseCreatedPrOutput('something else').number).toBeNaN();
    });
});

describe('createPullRequest', () => {
    it('passes title, body, base and head as separate argv entries', async () => {
        fake.on(['gh', 'pr', 'create'], { stdout: 'https://github.com/o/r/pull/9\n' });

        const pr = await createPullRequest('/repo', {
            title: 'feat: x',
            body: 'body with "quotes" and $vars',
            base: 'main',
            head: 'feat/x',
        });

        expect(pr.number).toBe(9);
        expect(fake.calls[0]).toEqual([
            'gh',
            'pr',
            'create',
            '--title',
            'feat: x',
            '--body',
            'body with "quotes" and $vars',
            '--base',
            'main',
            '--head',
            'feat/x',
        ]);
    });
});

describe('getPullRequestStatus', () => {
    it.each([
        [[], 'NONE'],
        [[{ conclusion: 'SUCCESS' }, { conclusion: 'SUCCESS' }], 'SUCCESS'],
        [[{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }], 'FAILURE'],
        [[{ conclusion: 'SUCCESS' }, { conclusion: null }], 'PENDING'],
    ])('maps rollup %j to checksStatus %s', async (rollup, expected) => {
        fake.on(['gh', 'pr', 'view'], prView({ statusCheckRollup: rollup }));

        const status = await getPullRequestStatus('/repo', 12);
        expect(status.checksStatus).toBe(expected);
    });

    it('treats a missing rollup as no checks and exposes the merge commit', async () => {
        fake.on(
            ['gh', 'pr', 'view'],
            prView({ statusCheckRollup: undefined, state: 'MERGED', mergeCommit: { oid: 'abc' } })
        );

        const status = await getPullRequestStatus('/repo', 12);
        expect(status).toMatchObject({ checksStatus: 'NONE', state: 'MERGED', mergeCommitSha: 'abc' });
        expect(fake.calls[0].slice(0, 4)).toEqual(['gh', 'pr', 'view', '12']);
    });
});

describe('mergePullRequest', () => {
    it('merges with the requested method then reports the merge commit', async () => {
        fake.on(['gh', 'pr', 'merge'], {});
        fake.on(['gh', 'pr', 'view'], prView({ state: 'MERGED', mergeCommit: { oid: 'deadbeef' } }));

        const result = await mergePullRequest('/repo', 12, 'rebase');

        expect(result).toEqual({ merged: true, mergeCommitSha: 'deadbeef' });
        expect(fake.calls[0]).toEqual(['gh', 'pr', 'merge', '12', '--rebase']);
    });

    it('defaults to squash and reports merged:false while the PR is still open', async () => {
        fake.on(['gh', 'pr', 'merge'], {});
        fake.on(['gh', 'pr', 'view'], prView());

        const result = await mergePullRequest('/repo', 12);

        expect(result).toEqual({ merged: false, mergeCommitSha: undefined });
        expect(fake.calls[0]).toEqual(['gh', 'pr', 'merge', '12', '--squash']);
    });
});
