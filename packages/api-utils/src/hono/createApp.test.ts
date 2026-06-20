import { describe, expect, it, vi } from 'vitest';
import { createApp } from './createApp';
import { APIError } from './errorHandler';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('createApp', () => {
    it('returns app with wired error handler', async () => {
        const app = createApp({ logger, allowedOrigins: ['https://allowed.test'] });
        app.get('/boom', () => {
            throw new APIError('bad', 400);
        });

        const res = await app.request('/boom');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'bad' });
    });

    it('reflects allowed origin', async () => {
        const app = createApp({ logger, allowedOrigins: ['https://allowed.test'] });
        app.get('/ok', (c) => c.text('ok'));

        const res = await app.request('/ok', { headers: { Origin: 'https://allowed.test' } });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.test');
    });

    it('does not emit a wildcard ACAO for non-allowed origins (credentials safety)', async () => {
        const app = createApp({ logger, allowedOrigins: ['https://allowed.test'] });
        app.get('/ok', (c) => c.text('ok'));

        const res = await app.request('/ok', { headers: { Origin: 'https://evil.test' } });
        expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    });
});
