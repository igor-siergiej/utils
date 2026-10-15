import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLiveSmoke } from '../e2e/liveRunner';
import { waitForChecks } from '../github/checks';
import { runGhJson } from '../github/gh';
import { createPullRequest, mergePullRequest } from '../github/pullRequest';
import { revertMergeCommit } from '../github/revert';
import { waitForWorkflowRun } from '../github/workflowPoller';
import { runArgv } from '../process/shell';
import { loadRepoConfig } from '../repoConfig/loader';
import type { RepoConfig } from '../repoConfig/types';
import { ship } from './ship';

vi.mock('../e2e/liveRunner', () => ({ runLiveSmoke: vi.fn() }));
vi.mock('../github/checks', () => ({ waitForChecks: vi.fn() }));
vi.mock('../github/gh', () => ({ runGhJson: vi.fn() }));
vi.mock('../github/pullRequest', () => ({ createPullRequest: vi.fn(), mergePullRequest: vi.fn() }));
vi.mock('../github/revert', () => ({ revertMergeCommit: vi.fn() }));
vi.mock('../github/workflowPoller', () => ({ waitForWorkflowRun: vi.fn() }));
vi.mock('../process/shell', () => ({ runArgv: vi.fn() }));
vi.mock('../repoConfig/loader', () => ({ loadRepoConfig: vi.fn() }));

const config = {
    ci: { workflowNames: ['CI'], checkNamesRequired: ['test'] },
    deploy: { workflowName: 'Deploy', timeoutMs: 900_000, pollIntervalMs: 15_000 },
    environments: { production: { baseUrl: 'https://app.example' } },
    targetEnvironment: 'production',
    github: { defaultBranch: 'main', mergeMethod: 'squash' },
} as unknown as RepoConfig;

const PR = { number: 12, url: 'https://github.com/o/r/pull/12' };
const REVERT_PR = { number: 13, url: 'https://github.com/o/r/pull/13' };
const smoke = (passed: boolean, failedTests: string[] = []) => ({
    passed,
    failedTests,
    durationMs: 1,
    startedApp: false,
    tearDownOk: true,
});

let gitStatus: string;
let branch: string;

beforeEach(() => {
    vi.resetAllMocks();
    gitStatus = '';
    branch = 'feat/thing';
    vi.mocked(loadRepoConfig).mockReturnValue({ configFound: true, config });
    vi.mocked(runArgv).mockImplementation(async (argv) => {
        const stdout = argv[1] === 'status' ? gitStatus : argv[1] === 'rev-parse' ? branch : '';
        return { exitCode: 0, stdout, stderr: '' };
    });
    vi.mocked(runGhJson).mockResolvedValue([]);
    vi.mocked(createPullRequest).mockResolvedValue(PR);
    vi.mocked(waitForChecks).mockResolvedValue({ status: 'success', checks: [] });
    vi.mocked(mergePullRequest).mockResolvedValue({ merged: true, mergeCommitSha: 'abc123' });
    vi.mocked(waitForWorkflowRun).mockResolvedValue({ status: 'success', runUrl: 'https://run/1' });
    vi.mocked(runLiveSmoke).mockResolvedValue(smoke(true));
    vi.mocked(revertMergeCommit).mockResolvedValue(REVERT_PR);
});

const shipIt = () => ship('/repo', { title: 'feat: thing', body: 'why' });

describe('ship', () => {
    it('pushes, opens a PR, waits for CI, merges, waits for deploy and passes live smoke', async () => {
        const { result } = await shipIt();

        expect(result).toEqual({
            stage: 'done',
            status: 'success',
            pr: PR,
            mergeCommitSha: 'abc123',
            deployRunUrl: 'https://run/1',
        });
        expect(runArgv).toHaveBeenCalledWith(['git', 'push', '-u', 'origin', 'feat/thing'], { cwd: '/repo' });
        expect(createPullRequest).toHaveBeenCalledWith('/repo', {
            title: 'feat: thing',
            body: 'why',
            base: 'main',
            head: 'feat/thing',
        });
        expect(waitForChecks).toHaveBeenCalledWith('/repo', 12, { timeoutMs: 1_800_000, requiredNames: ['test'] });
        expect(mergePullRequest).toHaveBeenCalledWith('/repo', 12, 'squash');
        expect(runLiveSmoke).toHaveBeenCalledWith('/repo', config, 'https://app.example');
    });

    it('reuses an already-open PR for the branch without needing a title', async () => {
        vi.mocked(runGhJson).mockResolvedValue([PR]);

        const { result } = await ship('/repo');

        expect(result.stage).toBe('done');
        expect(createPullRequest).not.toHaveBeenCalled();
    });

    it('requires a title and body when it has to create the PR', async () => {
        await expect(ship('/repo')).rejects.toThrow(/--title and --body/);
    });

    it('refuses to ship with uncommitted changes', async () => {
        gitStatus = ' M src/index.ts';

        await expect(shipIt()).rejects.toThrow(/uncommitted changes/);
        expect(runArgv).not.toHaveBeenCalledWith(expect.arrayContaining(['push']), expect.anything());
    });

    it('refuses to ship from the base branch', async () => {
        branch = 'main';

        await expect(shipIt()).rejects.toThrow(/base branch 'main'/);
    });

    it('stops before merging when CI fails, reporting the checks', async () => {
        const checks = [{ name: 'test', status: 'completed', conclusion: 'FAILURE' }];
        vi.mocked(waitForChecks).mockResolvedValue({ status: 'failure', checks });

        const { result } = await shipIt();

        expect(result).toEqual({ stage: 'ci', status: 'failure', pr: PR, failedChecks: checks });
        expect(mergePullRequest).not.toHaveBeenCalled();
    });

    it('reports a failed deploy without reverting', async () => {
        vi.mocked(waitForWorkflowRun).mockResolvedValue({ status: 'failure', runUrl: 'https://run/1' });

        const { result } = await shipIt();

        expect(result).toMatchObject({ stage: 'deploy', status: 'failure', mergeCommitSha: 'abc123' });
        expect(runLiveSmoke).not.toHaveBeenCalled();
        expect(revertMergeCommit).not.toHaveBeenCalled();
    });

    it('auto-reverts when live smoke fails and confirms the revert restored prod', async () => {
        vi.mocked(runLiveSmoke)
            .mockResolvedValueOnce(smoke(false, ['login works']))
            .mockResolvedValueOnce(smoke(true));
        vi.mocked(mergePullRequest)
            .mockResolvedValueOnce({ merged: true, mergeCommitSha: 'abc123' })
            .mockResolvedValueOnce({ merged: true, mergeCommitSha: 'def456' });

        const { result } = await shipIt();

        expect(result).toEqual({
            stage: 'e2e_live',
            status: 'failure',
            pr: PR,
            mergeCommitSha: 'abc123',
            failedTests: ['login works'],
            revert: { pr: REVERT_PR, status: 'success', restored: true },
        });
        expect(revertMergeCommit).toHaveBeenCalledWith('/repo', {
            commitSha: 'abc123',
            base: 'main',
            originalTitle: 'feat: thing',
            originalPrNumber: 12,
            failureSummary: 'Failed smoke tests: login works',
        });
        expect(mergePullRequest).toHaveBeenLastCalledWith('/repo', 13, 'squash');
    });

    it('flags restored: false when prod is still broken after the revert', async () => {
        vi.mocked(runLiveSmoke).mockResolvedValue(smoke(false, ['login works']));

        const { result } = await shipIt();

        expect(result.revert?.restored).toBe(false);
    });

    it('does not merge the revert when its CI fails', async () => {
        vi.mocked(runLiveSmoke).mockResolvedValue(smoke(false));
        vi.mocked(waitForChecks)
            .mockResolvedValueOnce({ status: 'success', checks: [] })
            .mockResolvedValueOnce({ status: 'failure', checks: [] });

        const { result } = await shipIt();

        expect(result.revert).toEqual({ pr: REVERT_PR, status: 'failure', restored: false });
        expect(mergePullRequest).toHaveBeenCalledTimes(1);
    });
});
