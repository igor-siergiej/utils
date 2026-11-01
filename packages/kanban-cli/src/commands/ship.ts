import { z } from 'zod';

import { runLiveSmoke } from '../e2e/liveRunner';
import { waitForChecks } from '../github/checks';
import { runGhJson } from '../github/gh';
import { createPullRequest, mergePullRequest } from '../github/pullRequest';
import { revertMergeCommit } from '../github/revert';
import type { CheckRunSummary, GateStatus, PrInfo } from '../github/types';
import { waitForWorkflowRun } from '../github/workflowPoller';
import { type RunArgv, runArgv } from '../process/shell';
import { RepoConfigError } from '../repoConfig/errors';
import { loadRepoConfig } from '../repoConfig/loader';
import type { RepoConfig } from '../repoConfig/types';

export interface ShipOptions {
    title?: string;
    body?: string;
    head?: string;
    ciTimeoutMs?: number;
}

/** Everything `ship` reaches outside the process through; tests pass fakes, `realShipDeps` is production. */
export interface ShipDeps {
    loadRepoConfig: typeof loadRepoConfig;
    runArgv: RunArgv;
    /** The open PR for `head`, if the branch already has one. */
    findOpenPr: (repoPath: string, head: string) => Promise<PrInfo | undefined>;
    createPullRequest: typeof createPullRequest;
    waitForChecks: typeof waitForChecks;
    mergePullRequest: typeof mergePullRequest;
    waitForWorkflowRun: typeof waitForWorkflowRun;
    runLiveSmoke: typeof runLiveSmoke;
    revertMergeCommit: typeof revertMergeCommit;
}

const openPrsSchema = z.array(z.object({ number: z.number(), url: z.string() }));

/** The open PR for `head` according to `gh pr list`, if the branch already has one. */
export async function findOpenPr(repoPath: string, head: string, run: RunArgv = runArgv): Promise<PrInfo | undefined> {
    const open = await runGhJson(
        ['pr', 'list', '--head', head, '--state', 'open', '--json', 'number,url'],
        { cwd: repoPath, run },
        openPrsSchema
    );

    return open[0];
}

export const realShipDeps: ShipDeps = {
    loadRepoConfig,
    runArgv,
    findOpenPr: (repoPath, head) => findOpenPr(repoPath, head),
    createPullRequest,
    waitForChecks,
    mergePullRequest,
    waitForWorkflowRun,
    runLiveSmoke,
    revertMergeCommit,
};

export interface ShipRevert {
    pr: PrInfo;
    status: GateStatus;
    /** True only when the revert deployed and the live smoke check passed again. */
    restored: boolean;
}

export interface ShipResult {
    stage: 'ci' | 'deploy' | 'e2e_live' | 'done';
    status: GateStatus;
    pr: PrInfo;
    mergeCommitSha?: string;
    failedChecks?: CheckRunSummary[];
    deployRunUrl?: string;
    failedTests?: string[];
    revert?: ShipRevert;
}

async function git(deps: ShipDeps, repoPath: string, args: string[]): Promise<string> {
    const result = await deps.runArgv(['git', ...args], { cwd: repoPath });

    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }

    return result.stdout.trim();
}

async function openPrFor(
    deps: ShipDeps,
    repoPath: string,
    head: string,
    base: string,
    options: ShipOptions
): Promise<PrInfo> {
    const existing = await deps.findOpenPr(repoPath, head);

    if (existing) return existing;

    if (!options.title || !options.body) {
        throw new Error(`no open PR for '${head}', so --title and --body are required to create one`);
    }

    return deps.createPullRequest(repoPath, { title: options.title, body: options.body, base, head });
}

async function mergeAndDeploy(
    deps: ShipDeps,
    repoPath: string,
    config: RepoConfig,
    prNumber: number,
    ciTimeoutMs: number
) {
    const checks = await deps.waitForChecks(repoPath, prNumber, {
        timeoutMs: ciTimeoutMs,
        requiredNames: config.ci.checkNamesRequired,
    });

    if (checks.status !== 'success') return { stage: 'ci' as const, status: checks.status, checks: checks.checks };

    const merge = await deps.mergePullRequest(repoPath, prNumber, config.github.mergeMethod);

    if (!merge.merged || !merge.mergeCommitSha) throw new Error(`PR #${prNumber} did not merge`);

    const deploy = await deps.waitForWorkflowRun(repoPath, config.deploy.workflowName, merge.mergeCommitSha, {
        timeoutMs: config.deploy.timeoutMs,
        intervalMs: config.deploy.pollIntervalMs,
    });

    return {
        stage: 'deploy' as const,
        status: deploy.status,
        mergeCommitSha: merge.mergeCommitSha,
        deployRunUrl: deploy.runUrl,
    };
}

/**
 * The PR → CI → merge → deploy → live smoke tail of the kanban-worker loop, for
 * ad-hoc work that never went through a board. A failed live smoke auto-reverts,
 * matching the worker's policy; CI and deploy failures stop and report instead.
 */
export async function ship(
    repoPath: string,
    options: ShipOptions = {},
    deps: ShipDeps = realShipDeps
): Promise<{ ok: true; result: ShipResult }> {
    const loaded = deps.loadRepoConfig(repoPath);

    if (!loaded.configFound) throw new RepoConfigError(`No .kanban-cli.json found at ${repoPath}`);
    const { config } = loaded;
    const base = config.github.defaultBranch;
    const ciTimeoutMs = options.ciTimeoutMs ?? 1_800_000;

    if (await git(deps, repoPath, ['status', '--porcelain'])) {
        throw new Error('working tree has uncommitted changes; commit (or stash) them before shipping');
    }

    const head = options.head ?? (await git(deps, repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']));

    if (head === base) throw new Error(`refusing to ship from the base branch '${base}'; commit on a feature branch`);

    await git(deps, repoPath, ['push', '-u', 'origin', head]);
    const pr = await openPrFor(deps, repoPath, head, base, options);

    const shipped = await mergeAndDeploy(deps, repoPath, config, pr.number, ciTimeoutMs);

    if (shipped.stage === 'ci') {
        return { ok: true, result: { stage: 'ci', status: shipped.status, pr, failedChecks: shipped.checks } };
    }

    if (shipped.status !== 'success') return { ok: true, result: { ...shipped, pr } };

    const baseUrl = config.environments[config.targetEnvironment].baseUrl;
    const live = await deps.runLiveSmoke(repoPath, config, baseUrl);

    if (live.passed) return { ok: true, result: { ...shipped, stage: 'done', pr } };

    const revertPr = await deps.revertMergeCommit(repoPath, {
        commitSha: shipped.mergeCommitSha,
        base,
        originalTitle: options.title ?? head,
        originalPrNumber: pr.number,
        failureSummary: `Failed smoke tests: ${live.failedTests.join(', ') || 'see the e2e report'}`,
    });

    const reverted = await mergeAndDeploy(deps, repoPath, config, revertPr.number, ciTimeoutMs);
    const restored = reverted.status === 'success' && (await deps.runLiveSmoke(repoPath, config, baseUrl)).passed;

    return {
        ok: true,
        result: {
            stage: 'e2e_live',
            status: 'failure',
            pr,
            mergeCommitSha: shipped.mergeCommitSha,
            failedTests: live.failedTests,
            revert: { pr: revertPr, status: reverted.status, restored },
        },
    };
}
