import type { Context } from 'hono';
import type { ILogger } from '../logger/types';
import type { RequestVariables } from './requestLogger';

export class APIError extends Error {
    public status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = 'APIError';
    }
}

// 5xx is logged at `error`, expected APIError 4xx (incl. 429) at `warn` so
// the dashboard's "Errors logged" panel reflects the right severity. If a
// logger is not provided (e.g. consumers still wiring it up), the handler
// silently degrades to its previous behaviour — just the JSON response.
export const errorHandler =
    (logger?: ILogger) =>
    (err: Error, c: Context<RequestVariables>): Response => {
        const e = err as { status?: number; message?: string };
        const statusCode = (e.status ?? 500) as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503;

        if (logger) {
            const requestId = c.get('requestId');
            const method = c.req.method;
            const path = c.req.path;
            const userId = c.get('userId');
            const message = err.message ?? 'Internal Server Error';
            const meta: Record<string, unknown> = {
                method,
                path,
                requestId,
                status: statusCode,
            };
            if (userId) meta.userId = userId;
            if (err instanceof APIError) {
                meta.errorName = err.name;
            } else {
                meta.stack = err.stack;
            }

            if (statusCode >= 500) {
                logger.error(message, { requestId }, meta);
            } else {
                logger.warn(message, { requestId }, meta);
            }
        }

        return c.json({ error: e.message ?? 'Internal Server Error' }, statusCode);
    };

// Keep the no-logger handler exported for backwards compatibility with
// consumers that called `app.onError(errorHandler)` directly without the
// factory. (createApp always wires the factory; this is only for tests
// and ad-hoc wiring.)
export const legacyErrorHandler = errorHandler();
