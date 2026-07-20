import { defaultUsageStatePath, writeUsageState } from '../usage/state';
import { parseFiveHourRateLimit } from '../usage/statuslinePayload';

export interface RecordUsageOptions {
    statePath?: string;
    now?: () => Date;
}

export function recordUsage(stdinText: string, options: RecordUsageOptions = {}): { ok: true } {
    try {
        const rateLimit = parseFiveHourRateLimit(JSON.parse(stdinText));
        if (rateLimit) {
            const now = options.now ?? (() => new Date());
            writeUsageState(options.statePath ?? defaultUsageStatePath(), {
                usedPct: rateLimit.usedPct,
                resetsAt: rateLimit.resetsAt,
                recordedAt: now().toISOString(),
            });
        }
    } catch {
        // Malformed/partial stdin — this runs fire-and-forget from the user's
        // statusline render path and must never surface an error there.
    }

    return { ok: true };
}
