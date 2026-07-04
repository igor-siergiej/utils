import { pollForCondition } from './pollForCondition';

export interface HealthCheckOptions {
    timeoutMs: number;
    intervalMs: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

export async function pollHttpHealth(url: string, options: HealthCheckOptions): Promise<boolean> {
    const fetchImpl = options.fetchImpl ?? fetch;

    const outcome = await pollForCondition<true>(
        async () => {
            try {
                const response = await fetchImpl(url);
                return response.ok ? true : null;
            } catch {
                return null;
            }
        },
        {
            timeoutMs: options.timeoutMs,
            intervalMs: options.intervalMs,
            sleep: options.sleep,
            now: options.now,
        }
    );

    return outcome.status === 'success';
}
