import { type CommandResult, runArgvStreaming } from '../process/shell';
import { claudeActivity } from './activity';
import type { Harness, HarnessOutcome } from './harness';
import { DEFAULT_QUOTA_PAUSE_MINUTES, isQuotaError, quotaWaitMs } from './quota';

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
    /** HTTP status of a provider error, e.g. 429 from a third-party endpoint. */
    api_error_status?: number;
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

export function parseClaudeRun(
    run: CommandResult,
    fallbackMinutes = DEFAULT_QUOTA_PAUSE_MINUTES,
    now = Date.now()
): HarnessOutcome {
    const all = events(run.stdout);
    const sessionId = all.find((e) => typeof e.session_id === 'string')?.session_id;
    const resets = all.map(rejectedReset).filter((r) => r !== undefined);
    if (resets.length > 0) {
        return { kind: 'rate_limited', resetsAt: new Date(Math.max(...resets) * 1000).toISOString(), sessionId };
    }

    const result = all.findLast((e) => e.type === 'result');
    // A third-party Anthropic-compatible endpoint reports its quota as an API
    // error, not as a rate_limit_event, so it would otherwise block the card.
    if (result && (result.is_error || run.exitCode !== 0)) {
        if (result.api_error_status === 429 || isQuotaError({ result: result.result })) {
            const wait = quotaWaitMs({ result: result.result });
            const resumeAt = wait === undefined ? now + fallbackMinutes * 60_000 : now + wait;
            return { kind: 'rate_limited', resetsAt: new Date(resumeAt).toISOString(), sessionId };
        }
    }

    if (run.exitCode === 0 && result && !result.is_error && sessionId) return { kind: 'done', sessionId };
    const summary = result?.is_error && typeof result.result === 'string' ? result.result : run.stderr.slice(-500);
    return { kind: 'failed', exitCode: run.exitCode, summary };
}

export const claudeHarness: Harness = {
    async run({ cwd, prompt, resume, model, quotaFallbackMinutes, onLine, signal }) {
        const result = await runArgvStreaming(claudeArgv({ prompt, resume, model }), {
            cwd,
            env: { CI: undefined },
            onLine,
            signal,
        });
        if (result.killed) {
            return {
                kind: 'stopped',
                sessionId: events(result.stdout).find((e) => typeof e.session_id === 'string')?.session_id,
            };
        }
        return parseClaudeRun(result, quotaFallbackMinutes);
    },
    activity: claudeActivity,
};
