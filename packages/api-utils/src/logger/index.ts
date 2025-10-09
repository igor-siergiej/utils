import type { ILogger } from './types';

export class Logger implements ILogger {
    private format(level: string, message: string, meta: Array<unknown>): string {
        const logObject = { level, message, ...(meta.length > 0 && { meta }) };

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
