import { waitForChecks } from '../github/checks';

export interface CiWaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
    requiredNames?: string[];
}

export async function ciWait(repoPath: string, prNumber: number, options: CiWaitOptions = {}) {
    const result = await waitForChecks(repoPath, prNumber, {
        timeoutMs: options.timeoutMs ?? 1_800_000,
        intervalMs: options.intervalMs,
        requiredNames: options.requiredNames,
    });
    return { ok: true as const, result };
}
