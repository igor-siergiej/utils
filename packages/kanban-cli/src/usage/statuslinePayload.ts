export interface FiveHourRateLimit {
    usedPct: number;
    resetsAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Parses the same JSON payload Claude Code feeds a statusLine hook on stdin,
 * pulling out the rolling 5-hour usage window. Tolerant of the field being
 * absent entirely (e.g. unmetered plans never send `rate_limits`).
 */
export function parseFiveHourRateLimit(raw: unknown): FiveHourRateLimit | undefined {
    const fiveHour = asRecord(asRecord(asRecord(raw)?.rate_limits)?.five_hour);
    if (!fiveHour) return undefined;

    const { used_percentage, resets_at } = fiveHour;
    if (typeof used_percentage !== 'number') return undefined;

    let resetsAt: string | undefined;
    if (typeof resets_at === 'string') resetsAt = resets_at;
    else if (typeof resets_at === 'number') resetsAt = new Date(resets_at * 1000).toISOString();
    if (!resetsAt) return undefined;

    return { usedPct: used_percentage, resetsAt };
}
