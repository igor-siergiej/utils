import { z } from 'zod';

import { pollForCondition } from '../process/pollForCondition';
import type { RunArgv } from '../process/shell';
import { runGhJson } from './gh';
import type { WorkflowRunSummary } from './types';

const rawRunsSchema = z.array(
    z.object({ headSha: z.string(), status: z.string(), conclusion: z.string().nullable(), url: z.string() })
);

export async function waitForWorkflowRun(
    repoPath: string,
    workflowName: string,
    commitSha: string,
    options: { timeoutMs: number; intervalMs?: number; run?: RunArgv }
): Promise<WorkflowRunSummary> {
    const intervalMs = options.intervalMs ?? 15000;

    const outcome = await pollForCondition<WorkflowRunSummary>(
        async () => {
            const raw = await runGhJson(
                ['run', 'list', '--workflow', workflowName, '--json', 'headSha,status,conclusion,url', '--limit', '20'],
                { cwd: repoPath, run: options.run },
                rawRunsSchema
            );

            const run = raw.find((r) => r.headSha === commitSha);

            if (!run || run.status !== 'completed') return null;

            return { status: run.conclusion === 'success' ? 'success' : 'failure', runUrl: run.url };
        },
        { timeoutMs: options.timeoutMs, intervalMs }
    );

    return outcome.status === 'timeout' ? { status: 'timeout' } : outcome.value;
}
