import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

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
    const status = (e.status ?? 500) as StatusCode;

    return c.json({ error: e.message ?? 'Internal Server Error' }, status);
};
