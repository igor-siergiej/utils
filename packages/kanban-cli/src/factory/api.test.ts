import { describe, expect, it, vi } from 'vitest';
import { ApiError, configFromEnv, dispatcherApi } from './api';

const CARD = { id: 'task-5', number: 5, project: 'tandra', title: 'card 5' };

function server(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetch };
}

describe('dispatcherApi', () => {
    it('claims with the dispatcher token and parses an empty queue', async () => {
        const { calls, fetch } = server(200, { run: null, block: [] });
        const api = dispatcherApi({ url: 'http://jott:8787/', token: 'tok-1', fetch });

        expect(await api.claim()).toEqual({ run: null, block: [] });
        expect(calls[0].url).toBe('http://jott:8787/v1/dispatcher/claim');
        expect(calls[0].init.method).toBe('POST');
        expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer tok-1');
    });

    it('throws the server error with its status on a non-2xx answer', async () => {
        const { fetch } = server(400, { error: 'run is not running' });
        const api = dispatcherApi({ url: 'http://jott', token: 't', fetch });

        const error = await api.heartbeat('r1', 'editing').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: 400, message: expect.stringContaining('run is not running') });
    });

    it('rejects a claim whose run lacks a card', async () => {
        const { fetch } = server(200, { run: { id: 'r1', harness: 'omp', model: 'm' }, block: [] });
        const api = dispatcherApi({ url: 'http://jott', token: 't', fetch });

        await expect(api.claim()).rejects.toThrow(/unexpected response/);
    });

    it('takes the run kind the server sends', async () => {
        const { fetch } = server(200, {
            run: { id: 'r1', kind: 'refine', card: CARD, harness: 'omp', model: 'm' },
            block: [],
        });
        const api = dispatcherApi({ url: 'http://jott', token: 't', fetch });

        expect((await api.claim()).run?.kind).toBe('refine');
    });

    it('accepts a run without a kind: an older server only ever runs builds', async () => {
        const { fetch } = server(200, { run: { id: 'r1', card: CARD, harness: 'omp', model: 'm' }, block: [] });
        const api = dispatcherApi({ url: 'http://jott', token: 't', fetch });

        expect((await api.claim()).run?.kind).toBeUndefined();
    });

    it('rejects a run with an unknown kind', async () => {
        const { fetch } = server(200, {
            run: { id: 'r1', kind: 'polish', card: CARD, harness: 'omp', model: 'm' },
            block: [],
        });
        const api = dispatcherApi({ url: 'http://jott', token: 't', fetch });

        await expect(api.claim()).rejects.toThrow(/unexpected response/);
    });
});

describe('configFromEnv', () => {
    it('names the env file when the url or token is missing', () => {
        expect(() => configFromEnv({ JOTT_URL: 'http://jott' })).toThrow(
            'JOTT_URL and JOTT_DISPATCHER_TOKEN must be set (~/.config/kanban-factory.env)'
        );
        expect(configFromEnv({ JOTT_URL: 'http://jott', JOTT_DISPATCHER_TOKEN: 't' })).toEqual({
            url: 'http://jott',
            token: 't',
        });
    });
});
