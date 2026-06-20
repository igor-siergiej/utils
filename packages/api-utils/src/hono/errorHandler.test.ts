import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { APIError, errorHandler } from './errorHandler';

const app = new Hono();
app.onError(errorHandler);
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
});
