import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { authenticate } from './authenticate';

const makeToken = (payload: Record<string, unknown>) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
};

const app = new Hono<{ Variables: { userId: string } }>();
app.use('/protected', authenticate);
app.get('/protected', (c) => c.json({ userId: c.get('userId') }));

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

describe('authenticate', () => {
    it('rejects missing header with 401', async () => {
        const res = await app.request('/protected');
        expect(res.status).toBe(401);
    });

    it('rejects malformed token with 401', async () => {
        const res = await app.request('/protected', { headers: { Authorization: 'Bearer not-a-jwt' } });
        expect(res.status).toBe(401);
    });

    it('rejects expired token with 401', async () => {
        const token = makeToken({ id: 'u1', exp: past });
        const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status).toBe(401);
    });

    it('rejects token without id with 401', async () => {
        const token = makeToken({ exp: future });
        const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status).toBe(401);
    });

    it('passes valid token and sets userId', async () => {
        const token = makeToken({ id: 'u1', exp: future });
        const res = await app.request('/protected', { headers: { Authorization: `Bearer ${token}` } });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ userId: 'u1' });
    });
});
