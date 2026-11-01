import { describe, expect, it, vi } from 'vitest';

import { fakeFetch } from '../testing/fakeFetch';
import { notify } from './notify';

const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

function recorder() {
    const calls: { url: string; init: RequestInit }[] = [];

    const fetch = fakeFetch(async (url, init) => {
        calls.push({ url, init });

        return new Response('{}');
    });

    return { calls, fetch };
}

describe('notify', () => {
    it('posts a block with the first reason line, cut to 200 chars', async () => {
        const { calls, fetch } = recorder();
        const reason = `${'x'.repeat(250)}\nsecond line \`$(rm)\``;

        await notify(
            { kind: 'blocked', project: 'tandra', number: 44, title: 'Fix login', reason },
            {
                url: 'http://ntfy/t',
                fetch,
            }
        );

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://ntfy/t');
        expect(headerOf(calls[0].init, 'Title')).toBe('tandra #44 blocked');
        expect(headerOf(calls[0].init, 'Markdown')).toBe('no');
        expect(calls[0].init.body).toBe(`Fix login\n${'x'.repeat(200)}`);
    });

    it('posts a done event with only the card title', async () => {
        const { calls, fetch } = recorder();

        await notify({ kind: 'done', project: 'jott', number: 7, title: 'Ship it', reason: 'ignored' }, { fetch });

        expect(headerOf(calls[0].init, 'Title')).toBe('jott #7 done');
        expect(calls[0].init.body).toBe('Ship it');
    });

    it('encodes a non-ASCII title header', async () => {
        const { calls, fetch } = recorder();

        await notify({ kind: 'done', project: 'zażółć', number: 1, title: 't' }, { fetch });

        const title = headerOf(calls[0].init, 'Title') ?? '';
        expect(title).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
        expect(Buffer.from(title.slice(10, -2), 'base64').toString()).toBe('zażółć #1 done');
    });

    it('resolves and logs when ntfy is down', async () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const fetch = fakeFetch(async () => {
            throw new Error('ECONNREFUSED');
        });

        await expect(notify({ kind: 'done', project: 'p', number: 1, title: 't' }, { fetch })).resolves.toBeUndefined();
        expect(String(stderr.mock.calls[0][0])).toContain('notify failed');
        stderr.mockRestore();
    });

    it('treats a non-2xx reply as a failure', async () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const fetch = fakeFetch(async () => new Response('', { status: 500 }));

        await notify({ kind: 'done', project: 'p', number: 1, title: 't' }, { fetch });

        expect(String(stderr.mock.calls[0][0])).toContain('HTTP 500');
        stderr.mockRestore();
    });
});
