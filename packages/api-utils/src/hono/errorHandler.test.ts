import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { APIError, errorHandler } from './errorHandler';
import type { RequestVariables } from './requestLogger';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const app = new Hono<RequestVariables>();
app.use('*', (c, next) => {
    c.set('requestId', 'test-req');
    return next();
});
app.onError(errorHandler(logger));
app.get('/api-error', () => {
    throw new APIError('nope', 404);
});
app.get('/plain-error', () => {
    throw new Error('boom');
});

describe('errorHandler', () => {
    it('maps APIError status and message', async () => {
        const res = await app.request('/api-error');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'nope' });
    });

    it('defaults plain errors to 500', async () => {
        const res = await app.request('/plain-error');
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'boom' });
    });

    it('logs APIError 4xx at warn with requestId, method, path, errorName', async () => {
        logger.warn.mockClear();
        await app.request('/api-error');
        expect(logger.warn).toHaveBeenCalledOnce();
        const message = logger.warn.mock.calls[0][0];
        expect(message).toBe('nope');
        const meta = logger.warn.mock.calls[0][2] as Record<string, unknown>;
        expect(meta).toMatchObject({
            method: 'GET',
            path: '/api-error',
            requestId: 'test-req',
            status: 404,
            errorName: 'APIError',
        });
    });

    it('logs plain 5xx at error with stack and no errorName', async () => {
        logger.error.mockClear();
        await app.request('/plain-error');
        expect(logger.error).toHaveBeenCalledOnce();
        const message = logger.error.mock.calls[0][0];
        expect(message).toBe('boom');
        const meta = logger.error.mock.calls[0][2] as Record<string, unknown>;
        expect(meta).toMatchObject({
            method: 'GET',
            path: '/plain-error',
            requestId: 'test-req',
            status: 500,
        });
        expect(meta.errorName).toBeUndefined();
        expect(typeof meta.stack).toBe('string');
    });

    it('falls back to no-logger behaviour when logger omitted', async () => {
        const noLogger = new Hono<RequestVariables>();
        noLogger.onError(errorHandler());
        noLogger.get('/e', () => {
            throw new APIError('silent', 400);
        });
        const res = await noLogger.request('/e');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'silent' });
    });
});
