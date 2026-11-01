import { z } from 'zod';

import type { JsonValue } from '../json';

const repoNameSchema = z.object({ repoName: z.json().optional() });

const fallbackMinutesSchema = z.object({
    factory: z
        .object({ rateLimitFallbackMinutes: z.number().positive().optional().catch(undefined) })
        .optional()
        .catch(undefined),
});

/**
 * Raw reads of `.kanban-cli.json`, for callers that must work with a config the full validator
 * would reject (a repo may carry only a `repoName`). Throws on malformed JSON.
 */
export function readRepoName(configText: string): JsonValue | undefined {
    return repoNameSchema.safeParse(JSON.parse(configText)).data?.repoName;
}

/** `factory.rateLimitFallbackMinutes` when present and a positive number. Throws on malformed JSON. */
export function readFallbackMinutes(configText: string): number | undefined {
    return fallbackMinutesSchema.safeParse(JSON.parse(configText)).data?.factory?.rateLimitFallbackMinutes;
}
