import { describe, expect, it } from 'vitest';
import { isQuotaError, quotaEpochReset, quotaWaitMs } from './quota';

describe('isQuotaError', () => {
    it('reads an HTTP 429 as a quota wall', () => {
        expect(isQuotaError({ errorStatus: 429 })).toBe(true);
        expect(isQuotaError({ status: '429' })).toBe(true);
    });

    it('reads the provider codes for an exhausted quota', () => {
        expect(isQuotaError({ error: { type: 'rate_limit_error' } })).toBe(true);
        expect(isQuotaError({ code: 'usage_limit_reached' })).toBe(true);
        expect(isQuotaError({ code: 'insufficient_quota' })).toBe(true);
    });

    it('reads a quota wall from the message text', () => {
        expect(isQuotaError({ errorMessage: 'quota exceeded for this account' })).toBe(true);
        expect(isQuotaError({ finalError: 'You have hit your usage limit.' })).toBe(true);
    });

    it('leaves an ordinary failure alone', () => {
        expect(isQuotaError({ error: { type: 'api_error', message: 'model overloaded' } })).toBe(false);
        expect(isQuotaError({ code: 'invalid_request_error', message: 'bad model name' })).toBe(false);
        expect(isQuotaError(undefined)).toBe(false);
    });
});

describe('quotaEpochReset', () => {
    it('reads epoch seconds, epoch millis and ISO strings', () => {
        expect(quotaEpochReset({ resets_at: 1_792_818_600 })).toBe(1_792_818_600_000);
        expect(quotaEpochReset({ resetsAt: 1_792_818_600_000 })).toBe(1_792_818_600_000);
        expect(quotaEpochReset({ reset_at: '2026-10-24T19:10:00.000Z' })).toBe(Date.parse('2026-10-24T19:10:00.000Z'));
    });

    it('has nothing to say when the provider gives no reset time', () => {
        expect(quotaEpochReset({ message: 'try later' })).toBeUndefined();
    });
});

describe('quotaWaitMs', () => {
    it('reads the wait a provider asked for', () => {
        expect(quotaWaitMs({ finalError: 'Provider requested 1596488ms wait, exceeds the cap' })).toBe(1_596_488);
        expect(quotaWaitMs({ errorMessage: '429 ... retry-after-ms=1596000' })).toBe(1_596_000);
    });

    it('has nothing to say when the provider gives no wait', () => {
        expect(quotaWaitMs({ message: 'try later' })).toBeUndefined();
    });
});
