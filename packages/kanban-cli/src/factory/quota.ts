/**
 * Quota detection shared by the factory harnesses.
 *
 * A provider that says "you hit your limit" must pause the card, not fail it: the
 * dispatcher keeps the card `in-progress` with `meta.paused_until` and resumes the
 * same session once the window rolls over. Only a real failure (a crash, a rejected
 * request) blocks the card.
 */
import { isRecord } from '../typeGuards';

/** Provider codes that mean "quota exhausted", not "your request was wrong". */
export const QUOTA_CODES: Record<string, true> = {
    usage_limit_reached: true,
    usage_not_included: true,
    insufficient_quota: true,
    rate_limit_error: true,
    quota_exceeded: true,
    limit_reached: true,
};

/** Message fragments providers use for the same condition. */
export const QUOTA_MESSAGE =
    /usage[_ -]?limit|insufficient[_ -]?quota|rate[_ -]?limit|quota (?:exceeded|reached|exhausted)|exceeded your (?:current )?quota|too many requests|resource[_ -]?exhausted/i;

/** How long to pause when a provider says "limited" but gives no reset time. */
export const DEFAULT_QUOTA_PAUSE_MINUTES = 30;

const CODE_FIELDS = ['code', 'type', 'status', 'errorStatus', 'error_status'];
const MESSAGE_FIELDS = [
    'message',
    'errorMessage',
    'error_message',
    'finalError',
    'final_error',
    'result',
    'summary',
    'detail',
];
const RESET_FIELDS = ['resets_at', 'resetsAt', 'reset_at', 'resetAt'];

/** "Provider requested 1596488ms wait" — how long the provider asked us to hold off. */
const WAIT_MS = /(\d+)\s*ms wait/i;
/** "retry-after-ms=1596000" — the raw header value appended to the error. */
const RETRY_AFTER_MS = /retry-after-ms=(\d+)/i;

/** True when the payload describes a quota wall rather than a bad request. */
export function isQuotaError(payload: unknown): boolean {
    if (!isRecord(payload)) return false;
    for (const field of CODE_FIELDS) {
        const value = payload[field];
        if (value === 429 || value === '429') return true;
        if (typeof value === 'string' && QUOTA_CODES[value.toLowerCase()] === true) return true;
    }
    for (const field of MESSAGE_FIELDS) {
        const value = payload[field];
        if (typeof value === 'string' && QUOTA_MESSAGE.test(value)) return true;
    }
    return payload.error !== undefined && isQuotaError(payload.error);
}

/** The absolute time the provider says the limit lifts, in epoch millis. */
export function quotaEpochReset(payload: unknown): number | undefined {
    if (!isRecord(payload)) return undefined;
    for (const field of RESET_FIELDS) {
        const value = payload[field];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            // Epoch seconds, unless the value is plainly already in millis.
            return value > 1e11 ? value : value * 1000;
        }
        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
}

/** How long the provider asked us to hold off, in millis. */
export function quotaWaitMs(payload: unknown): number | undefined {
    if (!isRecord(payload)) return undefined;
    for (const field of MESSAGE_FIELDS) {
        const text = payload[field];
        if (typeof text !== 'string') continue;
        const wait = WAIT_MS.exec(text) ?? RETRY_AFTER_MS.exec(text);
        if (wait?.[1]) {
            const ms = Number(wait[1]);
            if (Number.isFinite(ms) && ms > 0) return ms;
        }
    }
    return undefined;
}
