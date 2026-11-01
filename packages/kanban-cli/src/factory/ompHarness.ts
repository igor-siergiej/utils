import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type JsonObject, type JsonValue, jsonObject, jsonString, parseJsonObject } from '../json';
import { type CommandResult, runArgvStreaming } from '../process/shell';
import { ompActivity } from './activity';
import type { Harness, HarnessOutcome } from './harness';
import { DEFAULT_QUOTA_PAUSE_MINUTES, isQuotaError, quotaEpochReset, quotaWaitMs } from './quota';

/**
 * omp's `ask` tool blocks on a human answer. The factory runs unattended, so the
 * worker has to decide instead of asking; this overlay turns it off.
 */
export const UNATTENDED_OVERLAY = 'ask:\n  enabled: false\n';

/** Headless omp run: JSON events on stdout, every tool call auto-approved. */
export function ompArgv(opts: { prompt: string; resume?: string; config?: string; model?: string }): string[] {
    const resume = opts.resume ? ['--resume', opts.resume] : [];
    const config = opts.config ? ['--config', opts.config] : [];
    const model = opts.model ? ['--model', opts.model] : [];

    return ['omp', '-p', opts.prompt, '--mode', 'json', '--auto-approve', ...model, ...config, ...resume];
}

function events(stdout: string): JsonObject[] {
    return stdout.split('\n').flatMap((line) => {
        const event = parseJsonObject(line);

        if (!event) return [];

        // omp repeats the whole transcript in agent_end; nothing reads it.
        if (event.type === 'agent_end') delete event.messages;

        return [event];
    });
}

const sessionIdOf = (all: JsonObject[]) =>
    all.map((e) => (e.type === 'session' ? jsonString(e.id) : undefined)).find((id) => id !== undefined);

/**
 * When to resume a paused card: the provider's absolute reset if it is still
 * ahead, else the wait it asked for, else the default window.
 */
function quotaResumeAt(payloads: JsonValue[], now: number, fallbackMinutes: number): number {
    let epochReset: number | undefined;
    let waitMs: number | undefined;

    for (const payload of payloads) {
        epochReset ??= quotaEpochReset(payload);
        const candidate = quotaWaitMs(payload);

        if (candidate !== undefined && (waitMs === undefined || candidate > waitMs)) waitMs = candidate;
    }

    const fallback = now + fallbackMinutes * 60_000;
    const candidates = [epochReset, waitMs === undefined ? undefined : now + waitMs, fallback];

    return candidates.find((at) => at !== undefined && at > now) ?? fallback;
}

function failureSummary(failing: JsonObject[], stderr: string): string {
    for (const event of failing) {
        const message = event.message;
        const error = jsonObject(event.error);
        const messageObject = jsonObject(message);

        const text =
            jsonString(event.errorMessage) ??
            jsonString(event.finalError) ??
            jsonString(error?.message) ??
            jsonString(messageObject?.errorMessage) ??
            jsonString(message);

        if (text) return text.slice(0, 500);
    }

    return stderr.slice(-500);
}

/**
 * Reads one omp run into the outcome the dispatcher acts on.
 *
 * The last assistant message decides the outcome. omp retries transient provider
 * errors itself and leaves the failed attempt's events in the stream, so the first
 * error is not the answer: a run that retried and recovered ends on a normal
 * message and must count as done, not as a failure or a quota wall.
 */
export function parseOmpRun(
    run: CommandResult,
    now = Date.now(),
    fallbackMinutes = DEFAULT_QUOTA_PAUSE_MINUTES
): HarnessOutcome {
    const all = events(run.stdout);
    const sessionId = sessionIdOf(all);

    // The last assistant message decides the outcome. omp retries transient provider
    // errors itself and leaves the failed attempt's events in the stream, so the
    // first error is not the answer: a run that retried and recovered ends on a
    // normal message and must count as done, not as a failure or a quota wall.
    const assistantEvents = all.filter((e) => jsonObject(e.message)?.role === 'assistant');
    const lastAssistant = assistantEvents[assistantEvents.length - 1];
    const lastMessage = jsonObject(lastAssistant?.message);
    // Everything after the last assistant message belongs to that same attempt.
    const tail = all.slice(all.indexOf(lastAssistant) + 1);
    const failedMessage = lastMessage?.stopReason === 'error' ? lastMessage : undefined;
    const assistantFailed = failedMessage !== undefined;

    // The failing turn: the assistant events since the last one that ended normally.
    const lastGood = assistantEvents.findLastIndex((e) => {
        const message = jsonObject(e.message);

        return message !== undefined && message.stopReason !== 'error';
    });

    const failingTurn = assistantEvents.slice(lastGood + 1);

    const errorEvent =
        assistantEvents.length === 0 ? all.find((e) => e.type === 'error') : tail.find((e) => e.type === 'error');

    const failure = assistantFailed ? lastAssistant : errorEvent;

    if (failure) {
        const attempt = failedMessage ? [...failingTurn, failedMessage, ...tail] : [failure, ...tail];

        if (attempt.some((payload) => isQuotaError(payload))) {
            return {
                kind: 'rate_limited',
                resetsAt: new Date(quotaResumeAt(attempt, now, fallbackMinutes)).toISOString(),
                sessionId: sessionId || undefined,
            };
        }

        return {
            kind: 'failed',
            exitCode: run.exitCode,
            summary: failureSummary([...failingTurn, ...tail], run.stderr),
        };
    }

    if (run.exitCode !== 0) {
        return { kind: 'failed', exitCode: run.exitCode, summary: run.stderr.slice(-500) };
    }

    const end = all.findLast((e) => e.type === 'agent_end');

    if (end?.isTerminal === false) {
        return {
            kind: 'failed',
            exitCode: run.exitCode,
            summary: 'the agent yielded with work still queued',
        };
    }

    if (sessionId && end) {
        return { kind: 'done', sessionId };
    }

    return { kind: 'failed', exitCode: run.exitCode, summary: 'the run ended without a session id' };
}

export const ompHarness: Harness = {
    async run({ cwd, prompt, resume, model, quotaFallbackMinutes, onLine, signal }) {
        const dir = mkdtempSync(join(tmpdir(), 'kanban-omp-'));
        const config = join(dir, 'omp.yml');
        writeFileSync(config, UNATTENDED_OVERLAY);

        try {
            const result = await runArgvStreaming(ompArgv({ prompt, resume, config, model }), {
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

            return parseOmpRun(result, Date.now(), quotaFallbackMinutes);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
    activity: ompActivity,
};
