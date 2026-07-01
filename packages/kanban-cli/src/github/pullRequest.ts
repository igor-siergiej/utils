import { runGh, runGhJson } from './gh';
import type { PrInfo, PrStatus } from './types';

export function parseCreatedPrOutput(stdout: string): PrInfo {
    const url = stdout.trim().split('\n').pop() ?? '';
    const match = url.match(/\/pull\/(\d+)/);
    return { number: match ? Number(match[1]) : Number.NaN, url };
}

export async function createPullRequest(
    repoPath: string,
    options: { title: string; body: string; base: string; head: string }
): Promise<PrInfo> {
    const stdout = await runGh(
        [
            'pr',
            'create',
            '--title',
            options.title,
            '--body',
            options.body,
            '--base',
            options.base,
            '--head',
            options.head,
        ],
        { cwd: repoPath }
    );

    return parseCreatedPrOutput(stdout);
}

interface RawPrView {
    number: number;
    state: string;
    mergeable: string;
    statusCheckRollup?: Array<{ conclusion: string | null }>;
    reviewDecision: string | null;
    mergeCommit?: { oid: string } | null;
}

function summarizeChecks(rollup: Array<{ conclusion: string | null }>): PrStatus['checksStatus'] {
    if (rollup.length === 0) return 'NONE';
    if (rollup.some((c) => c.conclusion === 'FAILURE')) return 'FAILURE';
    if (rollup.every((c) => c.conclusion === 'SUCCESS')) return 'SUCCESS';
    return 'PENDING';
}

export async function getPullRequestStatus(repoPath: string, prNumber: number): Promise<PrStatus> {
    const raw = await runGhJson<RawPrView>(
        [
            'pr',
            'view',
            String(prNumber),
            '--json',
            'number,state,mergeable,statusCheckRollup,reviewDecision,mergeCommit',
        ],
        { cwd: repoPath }
    );

    return {
        number: raw.number,
        state: raw.state as PrStatus['state'],
        mergeable: raw.mergeable,
        checksStatus: summarizeChecks(raw.statusCheckRollup ?? []),
        reviewDecision: raw.reviewDecision,
        mergeCommitSha: raw.mergeCommit?.oid,
    };
}

export async function mergePullRequest(
    repoPath: string,
    prNumber: number,
    method: 'squash' | 'merge' | 'rebase' = 'squash'
): Promise<{ merged: boolean; mergeCommitSha?: string }> {
    await runGh(['pr', 'merge', String(prNumber), `--${method}`], { cwd: repoPath });

    const status = await getPullRequestStatus(repoPath, prNumber);
    return { merged: status.state === 'MERGED', mergeCommitSha: status.mergeCommitSha };
}
