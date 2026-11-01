/**
 * Quota detection shared by the factory harnesses.
 *
 * A provider that says "you hit your limit" must pause the card, not fail it: the
 * dispatcher ends the run `rate_limited` with the reset time, the card stays
 * `in-progress`, and the jott server resumes the same session once the window rolls
 * over. Only a real failure (a crash, a rejected request) blocks the card.
 */
import { type JsonValue, jsonNumber, jsonObject, jsonString } from '../json';

/** Provider codes that mean "quota exhausted", not "your request was wrong". */
export const QUOTA_CODES: ReadonlySet<string> = new Set([
    'usage_limit_reached',
    'usage_not_included',
    'insufficient_quota',
    'rate_limit_error',
    'quota_exceeded',
    'limit_reached',
]);

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
export function isQuotaError(payload: JsonValue | undefined): boolean {
    const record = jsonObject(payload);

    if (!record) return false;

    for (const field of CODE_FIELDS) {
        const value = record[field];

        if (value === 429 || value === '429') return true;

        const code = jsonString(value);

        if (code !== undefined && QUOTA_CODES.has(code.toLowerCase())) return true;
    }

    for (const field of MESSAGE_FIELDS) {
        const text = jsonString(record[field]);

        if (text !== undefined && QUOTA_MESSAGE.test(text)) return true;
    }

    return record.error !== undefined && isQuotaError(record.error);
}

/** The absolute time the provider says the limit lifts, in epoch millis. */
export function quotaEpochReset(payload: JsonValue | undefined): number | undefined {
    const record = jsonObject(payload);

    if (!record) return undefined;

    for (const field of RESET_FIELDS) {
        const value = record[field];
        const seconds = jsonNumber(value);

        if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) {
            // Epoch seconds, unless the value is plainly already in millis.
            return seconds > 1e11 ? seconds : seconds * 1000;
        }

        const text = jsonString(value);

        if (text !== undefined) {
            const parsed = Date.parse(text);

            if (Number.isFinite(parsed)) return parsed;
        }
    }

    return undefined;
}

/** How long the provider asked us to hold off, in millis. */
export function quotaWaitMs(payload: JsonValue | undefined): number | undefined {
    const record = jsonObject(payload);

    if (!record) return undefined;

    for (const field of MESSAGE_FIELDS) {
        const text = jsonString(record[field]);

        if (text === undefined) continue;
        const wait = WAIT_MS.exec(text) ?? RETRY_AFTER_MS.exec(text);

        if (wait?.[1]) {
            const ms = Number(wait[1]);

            if (Number.isFinite(ms) && ms > 0) return ms;
        }
    }

    return undefined;
}
