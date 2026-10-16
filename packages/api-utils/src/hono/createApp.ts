import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ILogger } from '../logger/types';
import { errorHandler } from './errorHandler';
import { type RequestVariables, requestLogger } from './requestLogger';

export interface CreateAppOptions {
    logger: ILogger;
    allowedOrigins: string[];
}

export const createApp = ({ logger, allowedOrigins }: CreateAppOptions): Hono<RequestVariables> => {
    const app = new Hono<RequestVariables>();

    app.use(
        '*',
        cors({
            // Reflect only allow-listed origins; non-allowed get no ACAO header
            // (returning '*' alongside credentials is rejected by browsers).
            origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
            credentials: true,
            allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
        })
    );

    app.use('*', requestLogger(logger));
    app.onError(errorHandler(logger));

    return app;
};
