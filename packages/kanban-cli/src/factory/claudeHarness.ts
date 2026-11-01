import { type JsonObject, jsonNumber, jsonObject, jsonString, parseJsonObject } from '../json';
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

function events(stdout: string): JsonObject[] {
    return stdout.split('\n').flatMap((line) => {
        const event = parseJsonObject(line);

        return event ? [event] : [];
    });
}

const sessionIdOf = (all: JsonObject[]) => all.map((e) => jsonString(e.session_id)).find((id) => id !== undefined);

/** Latest reset among the rejected windows of a `rate_limit_event`, in epoch seconds. */
function rejectedReset(e: JsonObject): number | undefined {
    const info = jsonObject(e.rate_limit_info);

    if (e.type !== 'rate_limit_event' || !info) return undefined;

    const rejected: number[] = [];

    for (const entry of Object.values(jsonObject(info.unifiedWindows) ?? {})) {
        const window = jsonObject(entry);
        const resetsAt = jsonNumber(window?.resetsAt);

        if (window?.status === 'rejected' && resetsAt !== undefined) rejected.push(resetsAt);
    }

    const own = jsonNumber(info.resetsAt);

    if (info.status === 'rejected' && own !== undefined) rejected.push(own);

    return rejected.length > 0 ? Math.max(...rejected) : undefined;
}

export function parseClaudeRun(
    run: CommandResult,
    fallbackMinutes = DEFAULT_QUOTA_PAUSE_MINUTES,
    now = Date.now()
): HarnessOutcome {
    const all = events(run.stdout);
    const sessionId = sessionIdOf(all);
    const resets = all.map(rejectedReset).filter((r) => r !== undefined);

    if (resets.length > 0) {
        return { kind: 'rate_limited', resetsAt: new Date(Math.max(...resets) * 1000).toISOString(), sessionId };
    }

    const result = all.findLast((e) => e.type === 'result');

    // A third-party Anthropic-compatible endpoint reports its quota as an API
    // error, not as a rate_limit_event, so it would otherwise block the card.
    if (result && (result.is_error || run.exitCode !== 0)) {
        const quotaPayload = { result: result.result ?? null };

        if (result.api_error_status === 429 || isQuotaError(quotaPayload)) {
            const wait = quotaWaitMs(quotaPayload);
            const resumeAt = wait === undefined ? now + fallbackMinutes * 60_000 : now + wait;

            return { kind: 'rate_limited', resetsAt: new Date(resumeAt).toISOString(), sessionId };
        }
    }

    if (run.exitCode === 0 && result && !result.is_error && sessionId) return { kind: 'done', sessionId };
    const summary = (result?.is_error ? jsonString(result.result) : undefined) ?? run.stderr.slice(-500);

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
                sessionId: sessionIdOf(events(result.stdout)),
            };
        }

        return parseClaudeRun(result, quotaFallbackMinutes);
    },
    activity: claudeActivity,
};
