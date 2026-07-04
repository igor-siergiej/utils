import { describe, expect, it } from 'vitest';
import { pollForCondition } from './pollForCondition';

function fakeClock(intervalMs: number) {
    let time = 0;
    return {
        now: () => time,
        sleep: async (ms: number) => {
            time += ms;
        },
        intervalMs,
    };
}

describe('pollForCondition', () => {
    it('returns success on the first attempt without sleeping', async () => {
        const clock = fakeClock(1000);
        let calls = 0;

        const outcome = await pollForCondition(
            async () => {
                calls += 1;
                return 'done';
            },
            { timeoutMs: 10000, intervalMs: clock.intervalMs, sleep: clock.sleep, now: clock.now }
        );

        expect(outcome).toEqual({ status: 'success', value: 'done' });
        expect(calls).toBe(1);
    });

    it('retries until the check succeeds, respecting the interval', async () => {
        const clock = fakeClock(1000);
        let calls = 0;

        const outcome = await pollForCondition(
            async () => {
                calls += 1;
                return calls >= 3 ? 'ready' : null;
            },
            { timeoutMs: 10000, intervalMs: clock.intervalMs, sleep: clock.sleep, now: clock.now }
        );

        expect(outcome).toEqual({ status: 'success', value: 'ready' });
        expect(calls).toBe(3);
    });

    it('gives up once the timeout budget is exhausted', async () => {
        const clock = fakeClock(1000);
        let calls = 0;

        const outcome = await pollForCondition(
            async () => {
                calls += 1;
                return null;
            },
            { timeoutMs: 3000, intervalMs: clock.intervalMs, sleep: clock.sleep, now: clock.now }
        );

        expect(outcome).toEqual({ status: 'timeout' });
        expect(calls).toBe(4);
    });

    it('always attempts at least once even with a zero timeout', async () => {
        let calls = 0;

        const outcome = await pollForCondition(
            async () => {
                calls += 1;
                return null;
            },
            { timeoutMs: 0, intervalMs: 1000, sleep: async () => {}, now: () => 0 }
        );

        expect(outcome).toEqual({ status: 'timeout' });
        expect(calls).toBe(1);
    });
});
