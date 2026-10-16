import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import type { ILogger } from '../logger/types';

// A request id, generated per request (or read from the inbound `X-Request-Id`
// header for distributed tracing), is set on the Hono context as
// `requestId` and returned to the client via the `X-Request-Id` response
// header so a single id can be cross-referenced between nginx access logs,
// api logs, and the user's error report.
export interface RequestVariables {
    Variables: {
        requestId: string;
        userId?: string;
    };
}

const REQUEST_ID_HEADER = 'x-request-id';
// Gatus polls /api/health every minute on every consumer; logging it as a
// real request drowns out actual traffic. Skip on success — the access log
// still has it, and the metrics scraper will surface any health failures.
const HEALTH_PATH = '/api/health';

export const requestLogger = (logger: ILogger) => async (c: Context<RequestVariables>, next: Next) => {
    const start = Date.now();

    const inboundRequestId = c.req.header(REQUEST_ID_HEADER);
    const requestId = inboundRequestId && inboundRequestId.length <= 200 ? inboundRequestId : randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);

    await next();

    const status = c.res.status;
    const durationMs = Date.now() - start;
    const url = c.req.path;
    const method = c.req.method;
    // Hono exposes the matched route pattern (e.g. "/api/designs/:id") under
    // `c.req.routePath`; useful for grouping requests by route, especially
    // for high-cardinality ObjectId paths.
    const route = c.req.routePath ?? url;

    if (url === HEALTH_PATH && status < 400) return;

    const meta: Record<string, unknown> = {
        method,
        path: url,
        route,
        status,
        durationMs,
        requestId,
    };
    const userId = c.get('userId');
    if (userId) meta.userId = userId;

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const message = `${method} ${route} - ${status} ${durationMs}ms`;
    // requestId is the only required structured field for correlating a
    // failure to the access log; passing it as the meta first entry keeps
    // the pre-existing `meta[0]` shape so existing dashboards still work.
    logger[level](message, { requestId }, meta);
};
