import { pollForCondition } from '../process/pollForCondition';
import { runGhJson } from './gh';
import type { CheckRunSummary, ChecksResult } from './types';

/**
 * One entry of `gh pr view --json statusCheckRollup`.
 *
 * `gh pr checks --json` would be the obvious call, but that flag only exists in
 * gh >= 2.48 and fails outright ("unknown flag: --json") on older installs, which
 * takes the whole CI gate down. The rollup carries the same data and its `--json`
 * support is as old as `gh pr view` itself.
 *
 * Two shapes share the list: GitHub Actions/App runs (`CheckRun`, with `status` +
 * `conclusion`) and commit statuses posted by external services (`StatusContext`,
 * with `context` + `state`).
 */
interface RollupEntry {
    __typename?: string;
    name?: string;
    context?: string;
    status?: string;
    state?: string;
    conclusion?: string | null;
}

interface RollupResponse {
    statusCheckRollup: RollupEntry[] | null;
}

type Bucket = 'pass' | 'fail' | 'pending';
const PASSING_CONCLUSIONS: Record<string, true> = { SUCCESS: true, NEUTRAL: true, SKIPPED: true };
const PENDING_STATES: Record<string, true> = { PENDING: true, EXPECTED: true };

function bucketOf(entry: RollupEntry): Bucket {
    if (entry.state !== undefined) {
        if (PENDING_STATES[entry.state] === true) return 'pending';
        return entry.state === 'SUCCESS' ? 'pass' : 'fail';
    }

    if (entry.status !== 'COMPLETED') return 'pending';
    return PASSING_CONCLUSIONS[entry.conclusion ?? ''] === true ? 'pass' : 'fail';
}

export interface ChecksSnapshot {
    /** `pending` means "poll again" — no terminal verdict yet. */
    status: 'success' | 'failure' | 'pending';
    checks: CheckRunSummary[];
}

export function summarizeChecks(entries: RollupEntry[], requiredNames?: string[]): ChecksSnapshot {
    const named = entries.map((entry) => ({ entry, name: entry.name ?? entry.context ?? 'unknown' }));
    const relevant = requiredNames?.length ? named.filter(({ name }) => requiredNames.includes(name)) : named;

    const checks: CheckRunSummary[] = relevant.map(({ entry, name }) => ({
        name,
        status: entry.status ?? entry.state ?? 'UNKNOWN',
        conclusion: entry.conclusion ?? entry.state ?? null,
    }));

    const buckets = relevant.map(({ entry }) => bucketOf(entry));
    if (buckets.includes('fail')) return { status: 'failure', checks };

    // A required check that GitHub has not reported yet is pending, not absent: a job
    // queued seconds after its siblings must not let the gate pass before it runs.
    const unreported = requiredNames?.filter((name) => !relevant.some((check) => check.name === name)) ?? [];
    if (unreported.length > 0) return { status: 'pending', checks };

    if (buckets.length > 0 && buckets.every((bucket) => bucket === 'pass')) return { status: 'success', checks };
    return { status: 'pending', checks };
}

export async function waitForChecks(
    repoPath: string,
    prNumber: number,
    options: { timeoutMs: number; intervalMs?: number; requiredNames?: string[] }
): Promise<ChecksResult> {
    const intervalMs = options.intervalMs ?? 15000;

    const outcome = await pollForCondition<ChecksResult>(
        async () => {
            const raw = await runGhJson<RollupResponse>(
                ['pr', 'view', String(prNumber), '--json', 'statusCheckRollup'],
                { cwd: repoPath }
            );

            const snapshot = summarizeChecks(raw.statusCheckRollup ?? [], options.requiredNames);
            return snapshot.status === 'pending' ? null : { status: snapshot.status, checks: snapshot.checks };
        },
        { timeoutMs: options.timeoutMs, intervalMs }
    );

    return outcome.status === 'timeout' ? { status: 'timeout', checks: [] } : outcome.value;
}
