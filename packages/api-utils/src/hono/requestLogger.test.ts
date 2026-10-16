import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { type RequestVariables, requestLogger } from './requestLogger';

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('requestLogger', () => {
    it('logs one completion line with structured fields', async () => {
        const logger = makeLogger();
        const app = new Hono<RequestVariables>();
        app.use('*', requestLogger(logger));
        app.get('/x', (c) => c.text('ok'));

        const res = await app.request('/x');

        expect(res.status).toBe(200);
        expect(res.headers.get('X-Request-Id')).toBeTruthy();
        expect(logger.info).toHaveBeenCalledOnce();
        const message = logger.info.mock.calls[0][0] as string;
        expect(message).toMatch(/^GET \/x - 200 \d+ms$/);

        const firstMeta = logger.info.mock.calls[0][1] as Record<string, unknown>;
        expect(typeof firstMeta.requestId).toBe('string');
        expect((firstMeta.requestId as string).length).toBeGreaterThan(0);

        const secondMeta = logger.info.mock.calls[0][2] as Record<string, unknown>;
        expect(secondMeta).toMatchObject({
            method: 'GET',
            path: '/x',
            status: 200,
        });
        expect(typeof secondMeta.durationMs).toBe('number');
        expect(secondMeta.requestId).toBe(firstMeta.requestId);
    });

    it('uses inbound X-Request-Id when present and well-formed', async () => {
        const logger = makeLogger();
        const app = new Hono<RequestVariables>();
        app.use('*', requestLogger(logger));
        app.get('/x', (c) => c.text('ok'));

        const res = await app.request('/x', { headers: { 'X-Request-Id': 'incoming-123' } });

        expect(res.headers.get('X-Request-Id')).toBe('incoming-123');
        const meta = logger.info.mock.calls[0][2] as Record<string, unknown>;
        expect(meta.requestId).toBe('incoming-123');
    });

    it('logs at warn on 4xx and error on 5xx', async () => {
        const logger = makeLogger();
        const app = new Hono<RequestVariables>();
        app.use('*', requestLogger(logger));
        app.get('/bad', (c) => c.json({ error: 'no' }, 400));
        app.get('/boom', (c) => c.json({ error: 'no' }, 500));

        await app.request('/bad');
        await app.request('/boom');

        expect(logger.warn).toHaveBeenCalledOnce();
        const warnMeta = logger.warn.mock.calls[0][2] as Record<string, unknown>;
        expect(warnMeta.status).toBe(400);

        expect(logger.error).toHaveBeenCalledOnce();
        const errorMeta = logger.error.mock.calls[0][2] as Record<string, unknown>;
        expect(errorMeta.status).toBe(500);
    });

    it('skips /api/health on success', async () => {
        const logger = makeLogger();
        const app = new Hono<RequestVariables>();
        app.use('*', requestLogger(logger));
        app.get('/api/health', (c) => c.text('ok'));

        const res = await app.request('/api/health');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Request-Id')).toBeTruthy();
        expect(logger.info).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('still logs /api/health on failure', async () => {
        const logger = makeLogger();
        const app = new Hono<RequestVariables>();
        app.use('*', requestLogger(logger));
        app.get('/api/health', (c) => c.json({ error: 'down' }, 500));

        await app.request('/api/health');
        expect(logger.error).toHaveBeenCalledOnce();
    });
});
