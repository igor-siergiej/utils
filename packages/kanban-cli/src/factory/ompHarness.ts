import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CommandResult, runArgv } from '../process/shell';
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

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Headless omp run: JSON events on stdout, every tool call auto-approved. */
export function ompArgv(opts: { prompt: string; resume?: string; config?: string }): string[] {
    const resume = opts.resume ? ['--resume', opts.resume] : [];
    const config = opts.config ? ['--config', opts.config] : [];
    return ['omp', '-p', opts.prompt, '--mode', 'json', '--auto-approve', ...config, ...resume];
}

function events(stdout: string): OmpEvent[] {
    return stdout.split('\n').flatMap((line) => {
        try {
            const parsed: unknown = JSON.parse(line);
            return isObject(parsed) ? [parsed as OmpEvent] : [];
        } catch {
            return [];
        }
    });
}

/**
 * Reads one omp run into the outcome the dispatcher acts on.
 *
 * omp reports a quota wall three ways, all of which mean "pause and resume later"
 * rather than "fail": an error event, an assistant message carrying an error
 * status, and its own retry summary. A provider that gives no reset time falls back
 * to a fixed pause.
 */
export function parseOmpRun(run: CommandResult, now = Date.now()): HarnessOutcome {
    const all = events(run.stdout);
    const sessionId = all.find((e) => e.type === 'session' && typeof e.id === 'string')?.id;

    const quotaEvent = all.find(
        (e) =>
            isQuotaError(e) ||
            (isObject(e.message) && isQuotaError(e.message)) ||
            (isObject(e.error) && isQuotaError(e.error))
    );
    if (quotaEvent) {
        let epochReset: number | undefined;
        let waitMs: number | undefined;
        for (const e of all) {
            for (const payload of [
                e,
                isObject(e.message) ? e.message : undefined,
                isObject(e.error) ? e.error : undefined,
            ]) {
                if (payload === undefined) continue;
                epochReset ??= quotaEpochReset(payload);
                const candidate = quotaWaitMs(payload);
                if (candidate !== undefined && (waitMs === undefined || candidate > waitMs)) waitMs = candidate;
            }
        }
        const resetAt = epochReset ?? (waitMs === undefined ? undefined : now + waitMs);
        return {
            kind: 'rate_limited',
            resetsAt: new Date(resetAt ?? now + DEFAULT_QUOTA_PAUSE_MINUTES * 60_000).toISOString(),
            ...(sessionId ? { sessionId } : {}),
        };
    }

    const failure = all.find((e) => e.type === 'error' || (isObject(e.message) && e.message.stopReason === 'error'));
    if (run.exitCode !== 0 || failure) {
        const message = failure?.message;
        const error = isObject(failure?.error) ? failure.error : undefined;
        const text =
            failure?.errorMessage ??
            failure?.finalError ??
            (typeof error?.message === 'string' ? error.message : undefined) ??
            (isObject(message) && typeof message.errorMessage === 'string' ? message.errorMessage : undefined) ??
            (typeof message === 'string' ? message : undefined);
        return {
            kind: 'failed',
            exitCode: run.exitCode,
            summary: text ? text.slice(0, 500) : run.stderr.slice(-500),
        };
    }

    if (sessionId && all.some((e) => e.type === 'agent_end')) {
        return { kind: 'done', sessionId };
    }
    return { kind: 'failed', exitCode: run.exitCode, summary: 'the run ended without a session id' };
}

export const ompHarness: Harness = {
    async run({ cwd, prompt, resume }) {
        const dir = mkdtempSync(join(tmpdir(), 'kanban-omp-'));
        const config = join(dir, 'omp.yml');
        writeFileSync(config, UNATTENDED_OVERLAY);
        try {
            return parseOmpRun(await runArgv(ompArgv({ prompt, resume, config }), { cwd, env: { CI: undefined } }));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
};
