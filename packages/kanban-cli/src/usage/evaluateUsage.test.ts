import { describe, expect, it } from 'vitest';
import { evaluateUsage } from './evaluateUsage';

const BASE_OPTIONS = { thresholdPct: 90, maxStalenessMs: 120_000 };
const RECORDED_AT = '2026-07-20T15:00:00.000Z';
const RECORDED_AT_MS = Date.parse(RECORDED_AT);

describe('evaluateUsage', () => {
    it('returns unknown when there is no state (never recorded yet)', () => {
        expect(evaluateUsage(undefined, { ...BASE_OPTIONS, now: () => RECORDED_AT_MS })).toEqual({ status: 'unknown' });
    });

    it('returns unknown when the recorded state is stale beyond maxStalenessMs', () => {
        const state = { usedPct: 95, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS + 120_001;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'unknown' });
    });

    it('treats a recordedAt in the future (clock skew) as unknown rather than trusting it', () => {
        const state = { usedPct: 95, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS - 1;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'unknown' });
    });

    it('returns ok when usage is below threshold and fresh', () => {
        const state = { usedPct: 62.4, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS + 1000;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'ok', usedPct: 62.4 });
    });

    it('returns pause with resetsAt when usage is at or above threshold', () => {
        const state = { usedPct: 90, resetsAt: '2026-07-20T18:00:00.000Z', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({
            status: 'pause',
            usedPct: 90,
            resetsAt: '2026-07-20T18:00:00.000Z',
        });
    });

    it('is exactly at the staleness boundary still counts as fresh', () => {
        const state = { usedPct: 50, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS + 120_000;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'ok', usedPct: 50 });
    });
});
