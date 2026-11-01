import { describe, expect, it } from 'vitest';

import { fakeFetch } from '../testing/fakeFetch';
import { pollHttpHealth } from './healthCheck';

function fakeClock() {
    let time = 0;

    return {
        now: () => time,
        sleep: async (ms: number) => {
            time += ms;
        },
    };
}

describe('pollHttpHealth', () => {
    it('returns true once the endpoint responds ok', async () => {
        const clock = fakeClock();
        let calls = 0;

        const fetchImpl = fakeFetch(async () => {
            calls += 1;

            return new Response(null, { status: calls >= 2 ? 200 : 503 });
        });

        const healthy = await pollHttpHealth('http://localhost:3000/health', {
            timeoutMs: 10000,
            intervalMs: 2000,
            fetchImpl,
            sleep: clock.sleep,
            now: clock.now,
        });

        expect(healthy).toBe(true);
        expect(calls).toBe(2);
    });

    it('returns false when the timeout budget is exhausted', async () => {
        const clock = fakeClock();
        const fetchImpl = fakeFetch(async () => new Response(null, { status: 503 }));

        const healthy = await pollHttpHealth('http://localhost:3000/health', {
            timeoutMs: 4000,
            intervalMs: 2000,
            fetchImpl,
            sleep: clock.sleep,
            now: clock.now,
        });

        expect(healthy).toBe(false);
    });

    it('treats a rejected fetch (connection refused) as not-yet-healthy rather than throwing', async () => {
        const clock = fakeClock();
        let calls = 0;

        const fetchImpl = fakeFetch(async () => {
            calls += 1;

            if (calls === 1) throw new Error('ECONNREFUSED');

            return new Response(null, { status: 200 });
        });

        const healthy = await pollHttpHealth('http://localhost:3000/health', {
            timeoutMs: 10000,
            intervalMs: 1000,
            fetchImpl,
            sleep: clock.sleep,
            now: clock.now,
        });

        expect(healthy).toBe(true);
        expect(calls).toBe(2);
    });
});
