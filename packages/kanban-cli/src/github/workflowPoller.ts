import { pollForCondition } from '../process/pollForCondition';
import { runGhJson } from './gh';
import type { WorkflowRunSummary } from './types';

interface RawRun {
    headSha: string;
    status: string;
    conclusion: string | null;
    url: string;
}

export async function waitForWorkflowRun(
    repoPath: string,
    workflowName: string,
    commitSha: string,
    options: { timeoutMs: number; intervalMs?: number }
): Promise<WorkflowRunSummary> {
    const intervalMs = options.intervalMs ?? 15000;

    const outcome = await pollForCondition<WorkflowRunSummary>(
        async () => {
            const raw = await runGhJson<RawRun[]>(
                ['run', 'list', '--workflow', workflowName, '--json', 'headSha,status,conclusion,url', '--limit', '20'],
                { cwd: repoPath }
            );

            const run = raw.find((r) => r.headSha === commitSha);
            if (!run || run.status !== 'completed') return null;

            return { status: run.conclusion === 'success' ? 'success' : 'failure', runUrl: run.url };
        },
        { timeoutMs: options.timeoutMs, intervalMs }
    );

    return outcome.status === 'timeout' ? { status: 'timeout' } : outcome.value;
}
