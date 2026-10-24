import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CommandResult, runArgv } from '../process/shell';
import { isRecord } from '../typeGuards';
import type { Harness, HarnessOutcome } from './harness';
import { DEFAULT_QUOTA_PAUSE_MINUTES, isQuotaError, quotaEpochReset, quotaWaitMs } from './quota';

/**
 * omp's `ask` tool blocks on a human answer. The factory runs unattended, so the
 * worker has to decide instead of asking; this overlay turns it off.
 */
export const UNATTENDED_OVERLAY = 'ask:\n  enabled: false\n';

interface OmpEvent {
    type?: string;
    id?: string;
    code?: string;
    message?: unknown;
    error?: unknown;
    errorStatus?: number;
    errorMessage?: string;
    success?: boolean;
    finalError?: string;
    isTerminal?: boolean;
}

/** Headless omp run: JSON events on stdout, every tool call auto-approved. */
export function ompArgv(opts: { prompt: string; resume?: string; config?: string; model?: string }): string[] {
    const resume = opts.resume ? ['--resume', opts.resume] : [];
    const config = opts.config ? ['--config', opts.config] : [];
    const model = opts.model ? ['--model', opts.model] : [];
    return ['omp', '-p', opts.prompt, '--mode', 'json', '--auto-approve', ...model, ...config, ...resume];
}

function events(stdout: string): OmpEvent[] {
    return stdout.split('\n').flatMap((line) => {
        try {
            const parsed: unknown = JSON.parse(line);
            if (!isRecord(parsed)) return [];
            // omp repeats the whole transcript in agent_end; nothing reads it.
            if (parsed.type === 'agent_end') delete parsed.messages;
            return [parsed as OmpEvent];
        } catch {
            return [];
        }
    });
}

/**
 * When to resume a paused card: the provider's absolute reset if it is still
 * ahead, else the wait it asked for, else the default window.
 */
function quotaResumeAt(payloads: unknown[], now: number): number {
    let epochReset: number | undefined;
    let waitMs: number | undefined;
    for (const payload of payloads) {
        epochReset ??= quotaEpochReset(payload);
        const candidate = quotaWaitMs(payload);
        if (candidate !== undefined && (waitMs === undefined || candidate > waitMs)) waitMs = candidate;
    }
    const fallback = now + DEFAULT_QUOTA_PAUSE_MINUTES * 60_000;
    const candidates = [epochReset, waitMs === undefined ? undefined : now + waitMs, fallback];
    return candidates.find((at) => at !== undefined && at > now) ?? fallback;
}

function failureSummary(failing: OmpEvent[], stderr: string): string {
    for (const event of failing) {
        const message = event.message;
        const error = isRecord(event.error) ? event.error : undefined;
        const text =
            event.errorMessage ??
            event.finalError ??
            (typeof error?.message === 'string' ? error.message : undefined) ??
            (isRecord(message) && typeof message.errorMessage === 'string' ? message.errorMessage : undefined) ??
            (typeof message === 'string' ? message : undefined);
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
export function parseOmpRun(run: CommandResult, now = Date.now()): HarnessOutcome {
    const all = events(run.stdout);
    const sessionId = all.find((e) => e.type === 'session' && typeof e.id === 'string')?.id;

    // The last assistant message decides the outcome. omp retries transient provider
    // errors itself and leaves the failed attempt's events in the stream, so the
    // first error is not the answer: a run that retried and recovered ends on a
    // normal message and must count as done, not as a failure or a quota wall.
    const assistantEvents = all.filter((e) => isRecord(e.message) && e.message.role === 'assistant');
    const lastAssistant = assistantEvents[assistantEvents.length - 1];
    const lastMessage = isRecord(lastAssistant?.message) ? lastAssistant.message : undefined;
    // Everything after the last assistant message belongs to that same attempt.
    const tail = all.slice(all.indexOf(lastAssistant) + 1);
    const assistantFailed = lastMessage?.stopReason === 'error';

    // The failing turn: the assistant events since the last one that ended normally.
    const lastGood = assistantEvents.findLastIndex((e) => isRecord(e.message) && e.message.stopReason !== 'error');
    const failingTurn = assistantEvents.slice(lastGood + 1);

    const errorEvent =
        assistantEvents.length === 0 ? all.find((e) => e.type === 'error') : tail.find((e) => e.type === 'error');
    const failure = assistantFailed ? lastAssistant : errorEvent;

    if (failure) {
        const attempt = assistantFailed ? [...failingTurn, lastMessage, ...tail] : [failure, ...tail];
        if (attempt.some((payload) => isQuotaError(payload))) {
            return {
                kind: 'rate_limited',
                resetsAt: new Date(quotaResumeAt(attempt, now)).toISOString(),
                ...(sessionId ? { sessionId } : {}),
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
    async run({ cwd, prompt, resume, model }) {
        const dir = mkdtempSync(join(tmpdir(), 'kanban-omp-'));
        const config = join(dir, 'omp.yml');
        writeFileSync(config, UNATTENDED_OVERLAY);
        try {
            return parseOmpRun(
                await runArgv(ompArgv({ prompt, resume, config, model }), { cwd, env: { CI: undefined } })
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
};
