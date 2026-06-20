import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { requestLogger } from './requestLogger';

describe('requestLogger', () => {
    it('logs incoming and completed request', async () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const app = new Hono();
        app.use('*', requestLogger(logger));
        app.get('/x', (c) => c.text('ok'));

        const res = await app.request('/x');

        expect(res.status).toBe(200);
        expect(logger.info).toHaveBeenCalledTimes(2);
        expect(logger.info.mock.calls[0][0]).toContain('Incoming request: GET');
        expect(logger.info.mock.calls[1][0]).toContain('GET');
        expect(logger.info.mock.calls[1][0]).toContain('200');
    });
});
