import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoConfig } from '../repoConfig/types';
import { ship, type ShipDeps } from './ship';

const config: RepoConfig = {
    repoName: 'app',
    dev: {
        startCommand: 'bun dev',
        healthCheckUrl: 'http://localhost:3000',
        healthCheckTimeoutMs: 1,
        healthCheckIntervalMs: 1,
    },
    e2e: { framework: 'playwright', testCommand: 'bun e2e', smokeGrep: '@smoke', configPath: 'playwright.config.ts' },
    ci: { workflowNames: ['CI'], checkNamesRequired: ['test'] },
    deploy: { workflowName: 'Deploy', timeoutMs: 900_000, pollIntervalMs: 15_000 },
    environments: { production: { baseUrl: 'https://app.example' } },
    targetEnvironment: 'production',
    retryPolicy: { implement: 3, e2e_local: 3, ci: 3, deploy: 2, e2e_live: 1 },
    github: { defaultBranch: 'main', mergeMethod: 'squash' },
};

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

const deps = {
    loadRepoConfig: vi.fn<ShipDeps['loadRepoConfig']>(),
    runArgv: vi.fn<ShipDeps['runArgv']>(),
    findOpenPr: vi.fn<ShipDeps['findOpenPr']>(),
    createPullRequest: vi.fn<ShipDeps['createPullRequest']>(),
    waitForChecks: vi.fn<ShipDeps['waitForChecks']>(),
    mergePullRequest: vi.fn<ShipDeps['mergePullRequest']>(),
    waitForWorkflowRun: vi.fn<ShipDeps['waitForWorkflowRun']>(),
    runLiveSmoke: vi.fn<ShipDeps['runLiveSmoke']>(),
    revertMergeCommit: vi.fn<ShipDeps['revertMergeCommit']>(),
} satisfies ShipDeps;

beforeEach(() => {
    vi.resetAllMocks();
    gitStatus = '';
    branch = 'feat/thing';
    deps.loadRepoConfig.mockReturnValue({ configFound: true, config });
    deps.runArgv.mockImplementation(async (argv) => {
        const stdout = argv[1] === 'status' ? gitStatus : argv[1] === 'rev-parse' ? branch : '';

        return { exitCode: 0, stdout, stderr: '' };
    });
    deps.findOpenPr.mockResolvedValue(undefined);
    deps.createPullRequest.mockResolvedValue(PR);
    deps.waitForChecks.mockResolvedValue({ status: 'success', checks: [] });
    deps.mergePullRequest.mockResolvedValue({ merged: true, mergeCommitSha: 'abc123' });
    deps.waitForWorkflowRun.mockResolvedValue({ status: 'success', runUrl: 'https://run/1' });
    deps.runLiveSmoke.mockResolvedValue(smoke(true));
    deps.revertMergeCommit.mockResolvedValue(REVERT_PR);
});

const shipIt = () => ship('/repo', { title: 'feat: thing', body: 'why' }, deps);

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
        expect(deps.runArgv).toHaveBeenCalledWith(['git', 'push', '-u', 'origin', 'feat/thing'], { cwd: '/repo' });
        expect(deps.createPullRequest).toHaveBeenCalledWith('/repo', {
            title: 'feat: thing',
            body: 'why',
            base: 'main',
            head: 'feat/thing',
        });
        expect(deps.waitForChecks).toHaveBeenCalledWith('/repo', 12, { timeoutMs: 1_800_000, requiredNames: ['test'] });
        expect(deps.mergePullRequest).toHaveBeenCalledWith('/repo', 12, 'squash');
        expect(deps.runLiveSmoke).toHaveBeenCalledWith('/repo', config, 'https://app.example');
    });

    it('reuses an already-open PR for the branch without needing a title', async () => {
        deps.findOpenPr.mockResolvedValue(PR);

        const { result } = await ship('/repo', {}, deps);

        expect(result.stage).toBe('done');
        expect(deps.createPullRequest).not.toHaveBeenCalled();
    });

    it('requires a title and body when it has to create the PR', async () => {
        await expect(ship('/repo', {}, deps)).rejects.toThrow(/--title and --body/);
    });

    it('refuses to ship with uncommitted changes', async () => {
        gitStatus = ' M src/index.ts';

        await expect(shipIt()).rejects.toThrow(/uncommitted changes/);
        expect(deps.runArgv).not.toHaveBeenCalledWith(expect.arrayContaining(['push']), expect.anything());
    });

    it('refuses to ship from the base branch', async () => {
        branch = 'main';

        await expect(shipIt()).rejects.toThrow(/base branch 'main'/);
    });

    it('stops before merging when CI fails, reporting the checks', async () => {
        const checks = [{ name: 'test', status: 'completed', conclusion: 'FAILURE' }];
        deps.waitForChecks.mockResolvedValue({ status: 'failure', checks });

        const { result } = await shipIt();

        expect(result).toEqual({ stage: 'ci', status: 'failure', pr: PR, failedChecks: checks });
        expect(deps.mergePullRequest).not.toHaveBeenCalled();
    });

    it('reports a failed deploy without reverting', async () => {
        deps.waitForWorkflowRun.mockResolvedValue({ status: 'failure', runUrl: 'https://run/1' });

        const { result } = await shipIt();

        expect(result).toMatchObject({ stage: 'deploy', status: 'failure', mergeCommitSha: 'abc123' });
        expect(deps.runLiveSmoke).not.toHaveBeenCalled();
        expect(deps.revertMergeCommit).not.toHaveBeenCalled();
    });

    it('auto-reverts when live smoke fails and confirms the revert restored prod', async () => {
        deps.runLiveSmoke.mockResolvedValueOnce(smoke(false, ['login works'])).mockResolvedValueOnce(smoke(true));
        deps.mergePullRequest
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
        expect(deps.revertMergeCommit).toHaveBeenCalledWith('/repo', {
            commitSha: 'abc123',
            base: 'main',
            originalTitle: 'feat: thing',
            originalPrNumber: 12,
            failureSummary: 'Failed smoke tests: login works',
        });
        expect(deps.mergePullRequest).toHaveBeenLastCalledWith('/repo', 13, 'squash');
    });

    it('flags restored: false when prod is still broken after the revert', async () => {
        deps.runLiveSmoke.mockResolvedValue(smoke(false, ['login works']));

        const { result } = await shipIt();

        expect(result.revert?.restored).toBe(false);
    });

    it('does not merge the revert when its CI fails', async () => {
        deps.runLiveSmoke.mockResolvedValue(smoke(false));
        deps.waitForChecks
            .mockResolvedValueOnce({ status: 'success', checks: [] })
            .mockResolvedValueOnce({ status: 'failure', checks: [] });

        const { result } = await shipIt();

        expect(result.revert).toEqual({ pr: REVERT_PR, status: 'failure', restored: false });
        expect(deps.mergePullRequest).toHaveBeenCalledTimes(1);
    });
});
