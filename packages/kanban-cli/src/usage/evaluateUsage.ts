import type { UsageState } from './types';

export type UsageCheckResult =
    /** `no-state`: nothing has ever been recorded; `stale`: telemetry stopped arriving. */
    | { status: 'unknown'; reason: 'no-state' | 'stale'; hint?: string }
    | { status: 'ok'; usedPct: number }
    | { status: 'pause'; usedPct: number; resetsAt: string };

export interface EvaluateUsageOptions {
    thresholdPct: number;
    maxStalenessMs: number;
    now: () => number;
}

export function evaluateUsage(state: UsageState | undefined, options: EvaluateUsageOptions): UsageCheckResult {
    if (!state) return { status: 'unknown', reason: 'no-state' };

    const ageMs = options.now() - Date.parse(state.recordedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > options.maxStalenessMs) {
        return { status: 'unknown', reason: 'stale' };
    }

    if (state.usedPct >= options.thresholdPct) {
        return { status: 'pause', usedPct: state.usedPct, resetsAt: state.resetsAt };
    }

    return { status: 'ok', usedPct: state.usedPct };
}
