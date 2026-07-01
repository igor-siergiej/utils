import { pollForCondition } from '../process/pollForCondition';
import { runGhJson } from './gh';
import type { CheckRunSummary, ChecksResult } from './types';

interface RawCheck {
    name: string;
    state: string;
    bucket: string;
}

export async function waitForChecks(
    repoPath: string,
    prNumber: number,
    options: { timeoutMs: number; intervalMs?: number; requiredNames?: string[] }
): Promise<ChecksResult> {
    const intervalMs = options.intervalMs ?? 15000;

    const outcome = await pollForCondition<ChecksResult>(
        async () => {
            const raw = await runGhJson<RawCheck[]>(['pr', 'checks', String(prNumber), '--json', 'name,state,bucket'], {
                cwd: repoPath,
            });

            const relevant = options.requiredNames?.length
                ? raw.filter((c) => options.requiredNames?.includes(c.name))
                : raw;

            const checks: CheckRunSummary[] = relevant.map((c) => ({
                name: c.name,
                status: c.state,
                conclusion: c.bucket,
            }));

            if (relevant.some((c) => c.bucket === 'fail' || c.bucket === 'cancel')) {
                return { status: 'failure', checks };
            }
            if (relevant.length > 0 && relevant.every((c) => c.bucket === 'pass')) {
                return { status: 'success', checks };
            }
            return null;
        },
        { timeoutMs: options.timeoutMs, intervalMs }
    );

    return outcome.status === 'timeout' ? { status: 'timeout', checks: [] } : outcome.value;
}
