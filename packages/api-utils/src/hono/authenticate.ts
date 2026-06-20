import type { Context, Next } from 'hono';

interface JWTPayload {
    username?: string;
    id: string;
    exp: number;
    iat: number;
}

const unauthorized = (c: Context, message: string) => c.json({ error: message }, 401);

/**
 * Decode-only JWT bearer auth (no signature verification — preserves existing
 * service behavior). Sets `userId` context variable on success.
 */
export const authenticate = async (c: Context<{ Variables: { userId: string } }>, next: Next) => {
    const authHeader = c.req.header('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return unauthorized(c, 'Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    const parts = token.split('.');

    if (parts.length !== 3) {
        return unauthorized(c, 'Invalid token format');
    }

    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8')) as JWTPayload;
        const now = Math.floor(Date.now() / 1000);

        if (payload.exp && payload.exp < now) {
            return unauthorized(c, 'Token expired');
        }

        if (!payload.id) {
            return unauthorized(c, 'Invalid token payload - missing id');
        }

        c.set('userId', payload.id);
        await next();
    } catch {
        return unauthorized(c, 'Invalid token');
    }
};
