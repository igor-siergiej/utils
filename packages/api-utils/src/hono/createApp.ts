import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ILogger } from '../logger/types';
import { errorHandler } from './errorHandler';
import { requestLogger } from './requestLogger';

export interface CreateAppOptions {
    logger: ILogger;
    allowedOrigins: string[];
}

export const createApp = ({ logger, allowedOrigins }: CreateAppOptions): Hono => {
    const app = new Hono();

    app.use(
        '*',
        cors({
            origin: (origin) => (allowedOrigins.includes(origin) ? origin : '*'),
            credentials: true,
            allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
        })
    );

    app.use('*', requestLogger(logger));
    app.onError(errorHandler);

    return app;
};
