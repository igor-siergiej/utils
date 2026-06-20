import type { Context, Next } from 'hono';
import type { ILogger } from '../logger/types';

export const requestLogger = (logger: ILogger) => async (c: Context, next: Next) => {
    const start = Date.now();
    const { method } = c.req;
    const url = c.req.path;

    logger.info(`Incoming request: ${method} ${url}`, {
        method,
        url,
        userAgent: c.req.header('user-agent') ?? 'unknown',
    });

    await next();

    const responseTime = Date.now() - start;
    logger.info(`${method} ${url} - ${c.res.status} ${responseTime}ms`);
};
