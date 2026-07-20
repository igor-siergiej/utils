import { describe, expect, it } from 'vitest';
import { parseFiveHourRateLimit } from './statuslinePayload';

describe('parseFiveHourRateLimit', () => {
    it('extracts usedPct and resetsAt (ISO string) from a well-formed statusline payload', () => {
        const payload = {
            rate_limits: {
                five_hour: { used_percentage: 62.4, resets_at: '2026-07-20T18:00:00.000Z' },
            },
        };
        expect(parseFiveHourRateLimit(payload)).toEqual({ usedPct: 62.4, resetsAt: '2026-07-20T18:00:00.000Z' });
    });

    it('normalizes a unix-seconds resets_at to an ISO string', () => {
        const payload = { rate_limits: { five_hour: { used_percentage: 10, resets_at: 1784649600 } } };
        expect(parseFiveHourRateLimit(payload)).toEqual({
            usedPct: 10,
            resetsAt: new Date(1784649600 * 1000).toISOString(),
        });
    });

    it('returns undefined when rate_limits is absent (unmetered plan)', () => {
        expect(parseFiveHourRateLimit({ model: { display_name: 'Sonnet' } })).toBeUndefined();
    });

    it('returns undefined when five_hour is absent', () => {
        expect(
            parseFiveHourRateLimit({ rate_limits: { seven_day: { used_percentage: 5, resets_at: 'x' } } })
        ).toBeUndefined();
    });

    it('returns undefined when used_percentage is missing or not a number', () => {
        expect(parseFiveHourRateLimit({ rate_limits: { five_hour: { resets_at: 'x' } } })).toBeUndefined();
        expect(
            parseFiveHourRateLimit({ rate_limits: { five_hour: { used_percentage: '10', resets_at: 'x' } } })
        ).toBeUndefined();
    });

    it('returns undefined when resets_at is missing or the wrong type', () => {
        expect(parseFiveHourRateLimit({ rate_limits: { five_hour: { used_percentage: 10 } } })).toBeUndefined();
        expect(
            parseFiveHourRateLimit({ rate_limits: { five_hour: { used_percentage: 10, resets_at: true } } })
        ).toBeUndefined();
    });

    it('returns undefined for non-object input', () => {
        expect(parseFiveHourRateLimit(null)).toBeUndefined();
        expect(parseFiveHourRateLimit('not json')).toBeUndefined();
        expect(parseFiveHourRateLimit(42)).toBeUndefined();
    });
});
