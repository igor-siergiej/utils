import type { ILogger } from './types';

export class Logger implements ILogger {
    private format(level: string, message: string, meta: Array<unknown>): string {
        // Stable shape so Promtail/Loki can `| json` and reach the structured
        // fields directly. ts is an ISO string. `meta` is kept as an array of
        // objects for backwards compat with the existing dashboards, which
        // already query `meta[0].userId` etc.; we also flatten the first
        // meta entry's keys to the top level so the new dashboards can use
        // `userId` directly without the `meta[0].` prefix.
        const logObject: Record<string, unknown> = {
            ts: new Date().toISOString(),
            level,
            message,
        };

        if (meta.length > 0) {
            logObject.meta = meta;
            const first = meta[0];
            if (first && typeof first === 'object') {
                for (const [key, value] of Object.entries(first as Record<string, unknown>)) {
                    if (key === 'ts' || key === 'level' || key === 'message' || key === 'meta') continue;
                    logObject[key] = value;
                }
            }
        }

        return JSON.stringify(logObject);
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
