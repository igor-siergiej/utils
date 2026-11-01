import { z } from 'zod';

import { type RunArgv, runArgv } from '../process/shell';
import { runGh, runGhJson } from './gh';
import type { PrInfo, PrStatus } from './types';

export function parseCreatedPrOutput(stdout: string): PrInfo {
    const url = stdout.trim().split('\n').pop() ?? '';
    const match = url.match(/\/pull\/(\d+)/);

    return { number: match ? Number(match[1]) : Number.NaN, url };
}

export async function createPullRequest(
    repoPath: string,
    options: { title: string; body: string; base: string; head: string },
    run: RunArgv = runArgv
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
        { cwd: repoPath, run }
    );

    return parseCreatedPrOutput(stdout);
}

const rawPrViewSchema = z.object({
    number: z.number(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    mergeable: z.string(),
    statusCheckRollup: z.array(z.object({ conclusion: z.string().nullable() })).nullish(),
    reviewDecision: z.string().nullable(),
    mergeCommit: z.object({ oid: z.string() }).nullish(),
});

function summarizeChecks(rollup: Array<{ conclusion: string | null }>): PrStatus['checksStatus'] {
    if (rollup.length === 0) return 'NONE';

    if (rollup.some((c) => c.conclusion === 'FAILURE')) return 'FAILURE';

    if (rollup.every((c) => c.conclusion === 'SUCCESS')) return 'SUCCESS';

    return 'PENDING';
}

export async function getPullRequestStatus(
    repoPath: string,
    prNumber: number,
    run: RunArgv = runArgv
): Promise<PrStatus> {
    const raw = await runGhJson(
        [
            'pr',
            'view',
            String(prNumber),
            '--json',
            'number,state,mergeable,statusCheckRollup,reviewDecision,mergeCommit',
        ],
        { cwd: repoPath, run },
        rawPrViewSchema
    );

    return {
        number: raw.number,
        state: raw.state,
        mergeable: raw.mergeable,
        checksStatus: summarizeChecks(raw.statusCheckRollup ?? []),
        reviewDecision: raw.reviewDecision,
        mergeCommitSha: raw.mergeCommit?.oid,
    };
}

export async function mergePullRequest(
    repoPath: string,
    prNumber: number,
    method: 'squash' | 'merge' | 'rebase' = 'squash',
    run: RunArgv = runArgv
): Promise<{ merged: boolean; mergeCommitSha?: string }> {
    await runGh(['pr', 'merge', String(prNumber), `--${method}`], { cwd: repoPath, run });

    const status = await getPullRequestStatus(repoPath, prNumber, run);

    return { merged: status.state === 'MERGED', mergeCommitSha: status.mergeCommitSha };
}
