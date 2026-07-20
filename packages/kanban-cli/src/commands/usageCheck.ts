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

export function usageCheck(options: UsageCheckOptions = {}): { ok: true; result: UsageCheckResult } {
    const state = readUsageState(options.statePath ?? defaultUsageStatePath());
    const result = evaluateUsage(state, {
        thresholdPct: options.thresholdPct ?? DEFAULT_THRESHOLD_PCT,
        maxStalenessMs: options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS,
        now: options.now ?? Date.now,
    });

    return { ok: true, result };
}
