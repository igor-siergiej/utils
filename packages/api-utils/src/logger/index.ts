import type { ILogger } from './types';

const RESERVED_KEYS = new Set(['ts', 'level', 'message', 'meta']);

export class Logger implements ILogger {
    private format(level: string, message: string, meta: Array<unknown>): string {
        // Stable shape so Promtail/Loki can `| json` and reach the structured
        // fields directly. ts is an ISO string. `meta` is kept as an array of
        // objects for backwards compat with the existing dashboards, which
        // already query `meta[0].userId` etc.; we also flatten the first
        // meta entry's keys to the top level so the new dashboards can use
        // `userId` directly without the `meta[0].` prefix.
        const base = {
            ts: new Date().toISOString(),
            level,
            message,
        };

        if (meta.length === 0) return JSON.stringify(base);

        const first = meta[0];
        // Object(first) === first is true only for objects (and functions); primitives are not flattened.
        const flattened = first && Object(first) === first ? Object.entries(first) : [];
        const topLevel = flattened.filter(([key]) => !RESERVED_KEYS.has(key));

        return JSON.stringify({ ...base, meta, ...Object.fromEntries(topLevel) });
    }

    public info = (message: string, ...meta: Array<unknown>): void => {
        console.log(this.format('info', message, meta));
    };

    public warn = (message: string, ...meta: Array<unknown>): void => {
        console.warn(this.format('warn', message, meta));
    };

    public error = (message: string, ...meta: Array<unknown>): void => {
        console.error(this.format('error', message, meta));
    };
}
