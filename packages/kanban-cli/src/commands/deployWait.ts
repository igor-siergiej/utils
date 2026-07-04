import { waitForWorkflowRun } from '../github/workflowPoller';

export interface DeployWaitOptions {
    workflow: string;
    commit: string;
    timeoutMs?: number;
    intervalMs?: number;
}

export async function deployWait(repoPath: string, options: DeployWaitOptions) {
    const result = await waitForWorkflowRun(repoPath, options.workflow, options.commit, {
        timeoutMs: options.timeoutMs ?? 900_000,
        intervalMs: options.intervalMs,
    });
    return { ok: true as const, result };
}
