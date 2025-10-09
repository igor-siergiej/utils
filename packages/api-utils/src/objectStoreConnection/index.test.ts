import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectStoreConnection } from './index';
import type { ObjectStoreConfig } from './types';

const state = vi.hoisted(() => ({
    getObject: vi.fn<(...args: Array<any>) => any>(() => Readable.from('ok')),
    statObject: vi.fn<(...args: Array<any>) => any>(() =>
        Promise.resolve({ metaData: { 'content-type': 'image/webp' } })
    ),
    putObject: vi.fn<(...args: Array<any>) => any>(() => Promise.resolve()),
    ctorArgs: [] as Array<any>,
}));

vi.mock('minio', () => {
    class FakeClient {
        public getObject: (...args: Array<any>) => any;
        public statObject: (...args: Array<any>) => any;
        public putObject: (...args: Array<any>) => any;
        constructor(opts: any) {
            state.ctorArgs.push(opts);
            this.getObject = (...a: Array<any>) => state.getObject(...a);
            this.statObject = (...a: Array<any>) => state.statObject(...a);
            this.putObject = (...a: Array<any>) => state.putObject(...a);
        }
    }

    return { Client: FakeClient };
});

describe('ObjectStoreConnection', () => {
    beforeEach(() => {
        state.getObject.mockReset().mockImplementation(() => Readable.from('ok'));
        state.statObject.mockReset().mockResolvedValue({ metaData: { 'content-type': 'image/webp' } });
        state.putObject.mockReset().mockResolvedValue(undefined);
        state.ctorArgs.length = 0;
    });

    it('throws when used before connect', async () => {
        const conn = new ObjectStoreConnection();

        await expect(conn.getObjectStream('x')).rejects.toThrow(/not connected/);
        await expect(conn.getHeadObject('x')).rejects.toThrow(/not connected/);
        await expect(conn.putObject('x', Buffer.from('a'))).rejects.toThrow(/not connected/);
    });

    it('throws on missing or incomplete configuration', async () => {
        const conn = new ObjectStoreConnection();

        await expect(conn.connect()).rejects.toThrow(/missing configuration/);

        const bad = { endpoint: 'host', accessKey: 'a', secretKey: '', bucketName: '' } as unknown as ObjectStoreConfig;

        await expect(conn.connect(bad)).rejects.toThrow(/incomplete configuration/);
    });

    it('connects, parses endpoint/port, and reuses or rebuilds client', async () => {
        const conn = new ObjectStoreConnection();

        await conn.connect({ endpoint: 'minio.local:9000', accessKey: 'ak', secretKey: 'sk', bucketName: 'bkt' });
        expect(state.ctorArgs).toHaveLength(1);
        expect(state.ctorArgs[0]).toMatchObject({
            endPoint: 'minio.local',
            port: 9000,
            useSSL: false,
            accessKey: 'ak',
            secretKey: 'sk',
        });

        // Reuse when endpoint unchanged
        await conn.connect({ endpoint: 'minio.local:9000', accessKey: 'ak', secretKey: 'sk', bucketName: 'other' });
        expect(state.ctorArgs).toHaveLength(1);

        // Recreate when endpoint changes or explicit port provided
        await conn.connect({
            endpoint: 'minio.other',
            port: 7001,
            accessKey: 'ak',
            secretKey: 'sk',
            bucketName: 'bkt',
        });
        expect(state.ctorArgs).toHaveLength(2);
        expect(state.ctorArgs[1]).toMatchObject({ endPoint: 'minio.other', port: 7001, useSSL: false });
    });

    it('connects with endpoint missing port and no explicit port', async () => {
        const conn = new ObjectStoreConnection();

        await conn.connect({ endpoint: 'minio.noport', accessKey: 'ak', secretKey: 'sk', bucketName: 'bkt' });
        expect(state.ctorArgs.at(-1)).toMatchObject({ endPoint: 'minio.noport', port: undefined, useSSL: false });
    });

    it('delegates getObjectStream/getHeadObject to client with bucketName', async () => {
        const conn = new ObjectStoreConnection();

        await conn.connect({ endpoint: 'h:1', accessKey: 'ak', secretKey: 'sk', bucketName: 'bucket' });

        const stream = await conn.getObjectStream('id1');

        expect(stream).toBeDefined();
        expect(state.getObject).toHaveBeenCalledWith('bucket', 'id1');

        const head = await conn.getHeadObject('id2');

        expect(head).toBeDefined();
        expect(state.statObject).toHaveBeenCalledWith('bucket', 'id2');
    });

    it('uploads buffer with size and metadata headers', async () => {
        const conn = new ObjectStoreConnection();

        await conn.connect({ endpoint: 'h:1', accessKey: 'ak', secretKey: 'sk', bucketName: 'bucket' });

        const buf = Buffer.from('hello');

        await conn.putObject('key', buf, { contentType: 'text/plain', metaData: { 'x-amz-meta-k': 'v' } });

        expect(state.putObject).toHaveBeenCalledWith(
            'bucket',
            'key',
            buf,
            buf.length,
            expect.objectContaining({ 'Content-Type': 'text/plain', 'x-amz-meta-k': 'v' })
        );
    });

    it('uploads stream with unknown size and metadata headers', async () => {
        const conn = new ObjectStoreConnection();

        await conn.connect({ endpoint: 'h:1', accessKey: 'ak', secretKey: 'sk', bucketName: 'bucket' });

        const stream = Readable.from('data');

        await conn.putObject('key', stream, { metaData: { a: '1' } });

        expect(state.putObject).toHaveBeenCalledWith(
            'bucket',
            'key',
            stream,
            undefined,
            expect.objectContaining({ a: '1' })
        );
    });
});
