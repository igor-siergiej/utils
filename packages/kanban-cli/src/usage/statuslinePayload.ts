import { z } from 'zod';

import type { JsonValue } from '../json';

export interface FiveHourRateLimit {
    usedPct: number;
    resetsAt: string;
}

const rateLimitSchema = z
    .object({
        rate_limits: z.object({
            five_hour: z.object({
                used_percentage: z.number(),
                resets_at: z.union([
                    z.string().min(1),
                    z.number().transform((epochSeconds) => new Date(epochSeconds * 1000).toISOString()),
                ]),
            }),
        }),
    })
    .transform(({ rate_limits }): FiveHourRateLimit => ({
        usedPct: rate_limits.five_hour.used_percentage,
        resetsAt: rate_limits.five_hour.resets_at,
    }));

/**
 * Parses the same JSON payload Claude Code feeds a statusLine hook on stdin,
 * pulling out the rolling 5-hour usage window. Tolerant of the field being
 * absent entirely (e.g. unmetered plans never send `rate_limits`).
 */
export function parseFiveHourRateLimit(raw: JsonValue): FiveHourRateLimit | undefined {
    return rateLimitSchema.safeParse(raw).data;
}
