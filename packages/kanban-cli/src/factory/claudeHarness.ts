import { type CommandResult, runArgv } from '../process/shell';
import type { Harness, HarnessOutcome } from './harness';

export function claudeArgv(opts: { prompt: string; resume?: string; model?: string }): string[] {
    const resume = opts.resume ? ['--resume', opts.resume] : [];
    const model = opts.model ? ['--model', opts.model] : [];
    return [
        'claude',
        '-p',
        '--dangerously-skip-permissions',
        ...model,
        ...resume,
        '--output-format',
        'stream-json',
        '--verbose',
        opts.prompt,
    ];
}

interface StreamEvent {
    type?: string;
    session_id?: string;
    is_error?: boolean;
    result?: unknown;
    rate_limit_info?: {
        status?: string;
        resetsAt?: number;
        unifiedWindows?: Record<string, { status?: string; resetsAt?: number }>;
    };
}

function events(stdout: string): StreamEvent[] {
    return stdout.split('\n').flatMap((line) => {
        try {
            const parsed: unknown = JSON.parse(line);
            return typeof parsed === 'object' && parsed !== null ? [parsed as StreamEvent] : [];
        } catch {
            return [];
        }
    });
}

/** Latest reset among the rejected windows of a `rate_limit_event`, in epoch seconds. */
function rejectedReset(e: StreamEvent): number | undefined {
    const info = e.rate_limit_info;
    if (e.type !== 'rate_limit_event' || !info) return undefined;
    const windows = Object.values(info.unifiedWindows ?? {}).filter((w) => w.status === 'rejected');
    const resets = windows.map((w) => w.resetsAt).filter((r): r is number => typeof r === 'number');
    if (info.status === 'rejected' && typeof info.resetsAt === 'number') resets.push(info.resetsAt);
    return resets.length > 0 ? Math.max(...resets) : undefined;
}

export function parseClaudeRun(run: CommandResult): HarnessOutcome {
    const all = events(run.stdout);
    const sessionId = all.find((e) => typeof e.session_id === 'string')?.session_id;
    const resets = all.map(rejectedReset).filter((r): r is number => r !== undefined);
    if (resets.length > 0) {
        return { kind: 'rate_limited', resetsAt: new Date(Math.max(...resets) * 1000).toISOString(), sessionId };
    }
    const result = all.findLast((e) => e.type === 'result');
    if (run.exitCode === 0 && result && !result.is_error && sessionId) return { kind: 'done', sessionId };
    const summary = result?.is_error && typeof result.result === 'string' ? result.result : run.stderr.slice(-500);
    return { kind: 'failed', exitCode: run.exitCode, summary };
}

export const claudeHarness: Harness = {
    async run({ cwd, prompt, resume, model }) {
        return parseClaudeRun(await runArgv(claudeArgv({ prompt, resume, model }), { cwd, env: { CI: undefined } }));
    },
};
