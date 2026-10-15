import { runLiveSmoke } from '../e2e/liveRunner';
import { waitForChecks } from '../github/checks';
import { runGhJson } from '../github/gh';
import { createPullRequest, mergePullRequest } from '../github/pullRequest';
import { revertMergeCommit } from '../github/revert';
import type { CheckRunSummary, GateStatus, PrInfo } from '../github/types';
import { waitForWorkflowRun } from '../github/workflowPoller';
import { runArgv } from '../process/shell';
import { RepoConfigError } from '../repoConfig/errors';
import { loadRepoConfig } from '../repoConfig/loader';
import type { RepoConfig } from '../repoConfig/types';

export interface ShipOptions {
    title?: string;
    body?: string;
    head?: string;
    ciTimeoutMs?: number;
}

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

async function git(repoPath: string, args: string[]): Promise<string> {
    const result = await runArgv(['git', ...args], { cwd: repoPath });
    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
}

async function openPrFor(repoPath: string, head: string, base: string, options: ShipOptions): Promise<PrInfo> {
    const existing = await runGhJson<PrInfo[]>(
        ['pr', 'list', '--head', head, '--state', 'open', '--json', 'number,url'],
        { cwd: repoPath }
    );
    if (existing[0]) return existing[0];

    if (!options.title || !options.body) {
        throw new Error(`no open PR for '${head}', so --title and --body are required to create one`);
    }
    return createPullRequest(repoPath, { title: options.title, body: options.body, base, head });
}

async function mergeAndDeploy(repoPath: string, config: RepoConfig, prNumber: number, ciTimeoutMs: number) {
    const checks = await waitForChecks(repoPath, prNumber, {
        timeoutMs: ciTimeoutMs,
        requiredNames: config.ci.checkNamesRequired,
    });
    if (checks.status !== 'success') return { stage: 'ci' as const, status: checks.status, checks: checks.checks };

    const merge = await mergePullRequest(repoPath, prNumber, config.github.mergeMethod);
    if (!merge.merged || !merge.mergeCommitSha) throw new Error(`PR #${prNumber} did not merge`);

    const deploy = await waitForWorkflowRun(repoPath, config.deploy.workflowName, merge.mergeCommitSha, {
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
export async function ship(repoPath: string, options: ShipOptions = {}): Promise<{ ok: true; result: ShipResult }> {
    const loaded = loadRepoConfig(repoPath);
    if (!loaded.configFound) throw new RepoConfigError(`No .kanban-cli.json found at ${repoPath}`);
    const { config } = loaded;
    const base = config.github.defaultBranch;
    const ciTimeoutMs = options.ciTimeoutMs ?? 1_800_000;

    if (await git(repoPath, ['status', '--porcelain'])) {
        throw new Error('working tree has uncommitted changes; commit (or stash) them before shipping');
    }
    const head = options.head ?? (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']));
    if (head === base) throw new Error(`refusing to ship from the base branch '${base}'; commit on a feature branch`);

    await git(repoPath, ['push', '-u', 'origin', head]);
    const pr = await openPrFor(repoPath, head, base, options);

    const shipped = await mergeAndDeploy(repoPath, config, pr.number, ciTimeoutMs);
    if (shipped.stage === 'ci') {
        return { ok: true, result: { stage: 'ci', status: shipped.status, pr, failedChecks: shipped.checks } };
    }
    if (shipped.status !== 'success') return { ok: true, result: { ...shipped, pr } };

    const baseUrl = config.environments[config.targetEnvironment].baseUrl;
    const live = await runLiveSmoke(repoPath, config, baseUrl);
    if (live.passed) return { ok: true, result: { ...shipped, stage: 'done', pr } };

    const revertPr = await revertMergeCommit(repoPath, {
        commitSha: shipped.mergeCommitSha,
        base,
        originalTitle: options.title ?? head,
        originalPrNumber: pr.number,
        failureSummary: `Failed smoke tests: ${live.failedTests.join(', ') || 'see the e2e report'}`,
    });
    const reverted = await mergeAndDeploy(repoPath, config, revertPr.number, ciTimeoutMs);
    const restored = reverted.status === 'success' && (await runLiveSmoke(repoPath, config, baseUrl)).passed;

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
