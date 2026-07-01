export interface PollOptions {
    timeoutMs: number;
    intervalMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

export type PollOutcome<T> = { status: 'success'; value: T } | { status: 'timeout' };

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `check` until it returns a non-null value (terminal) or the timeout
 * budget is exhausted. Always attempts at least once. `check` itself decides
 * what "terminal" means for its domain (e.g. a CI conclusion of success OR
 * failure are both terminal; only "still pending" polls again).
 */
export async function pollForCondition<T>(
    check: () => Promise<T | null>,
    options: PollOptions
): Promise<PollOutcome<T>> {
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    const deadline = now() + options.timeoutMs;

    for (;;) {
        const result = await check();
        if (result !== null) return { status: 'success', value: result };

        if (now() >= deadline) return { status: 'timeout' };

        await sleep(options.intervalMs);
    }
}
