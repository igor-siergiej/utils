import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UsageCheckResult } from '../usage/evaluateUsage';
import { evaluateUsage } from '../usage/evaluateUsage';
import { defaultUsageStatePath, readUsageState } from '../usage/state';

export interface UsageCheckOptions {
    thresholdPct?: number;
    maxStalenessMs?: number;
    statePath?: string;
    now?: () => number;
}

const DEFAULT_THRESHOLD_PCT = 90;
const DEFAULT_MAX_STALENESS_MS = 120_000;

const unwiredHint = (statePath: string) =>
    `No usage telemetry has ever been recorded at ${statePath}, so usage-check cannot pause ` +
    "before the 5-hour limit. Pipe your Claude Code statusLine JSON into 'kanban-cli record-usage' " +
    "(README: 'Pausing on the 5-hour usage limit'). This hint is shown once.";

/** Returns the hint the first time only, leaving a marker beside the state file. */
function hintOnce(statePath: string): string | undefined {
    const marker = `${statePath}.hint-shown`;
    if (existsSync(marker)) return undefined;

    try {
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, new Date().toISOString());
    } catch {
        // An unwritable marker only means the hint repeats; never fail the gate over it.
    }
    return unwiredHint(statePath);
}

export function usageCheck(options: UsageCheckOptions = {}): { ok: true; result: UsageCheckResult } {
    const statePath = options.statePath ?? defaultUsageStatePath();
    const state = readUsageState(statePath);
    const result = evaluateUsage(state, {
        thresholdPct: options.thresholdPct ?? DEFAULT_THRESHOLD_PCT,
        maxStalenessMs: options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS,
        now: options.now ?? Date.now,
    });

    if (result.status === 'unknown' && result.reason === 'no-state') {
        const hint = hintOnce(statePath);
        if (hint) return { ok: true, result: { ...result, hint } };
    }

    return { ok: true, result };
}
