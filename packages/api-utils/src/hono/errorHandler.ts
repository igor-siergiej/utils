import type { Context } from 'hono';

export class APIError extends Error {
    public status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = 'APIError';
    }
}

export const errorHandler = (err: Error, c: Context): Response => {
    const e = err as { status?: number; message?: string };
    const statusCode = (e.status ?? 500) as any;

    return c.json({ error: e.message ?? 'Internal Server Error' }, statusCode);
};
