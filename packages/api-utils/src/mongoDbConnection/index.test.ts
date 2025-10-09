import * as mongodb from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MongoDbConnection } from './index';
import type { MongoConfig } from './types';

// Minimal type map
interface TestDoc extends mongodb.Document {
    name: string;
}
type Map = Record<'test', TestDoc>;

describe('MongoDbConnection', () => {
    const connect = vi.fn();
    const db = vi.fn();
    const collection = vi.fn(() => ({ findOne: vi.fn() }) as unknown as mongodb.Collection<any>);
    let ctorUris: Array<string> = [];
    let dbShouldThrow = false;

    beforeEach(() => {
        connect.mockReset();
        db.mockReset();
        collection.mockReset();
        ctorUris = [];
        dbShouldThrow = false;

        vi.spyOn(mongodb, 'MongoClient').mockImplementation(
            // @ts-expect-error partial mock sufficient for tests
            function Fake(this: any, uri: string) {
                ctorUris.push(uri);
                this.connect = connect;
                this.db = (_: string) => {
                    if (dbShouldThrow) throw new Error('fail create db');

                    return { collection } as unknown as mongodb.Db;
                };
            } as unknown as new (
                ...args: Array<any>
            ) => mongodb.MongoClient
        );
    });

    it('connects and returns typed collection', async () => {
        const cfg: MongoConfig = { connectionUri: 'mongodb://localhost:27017', databaseName: 'db' };
        const conn = new MongoDbConnection<Map>();

        await conn.connect(cfg);
        expect(connect).toHaveBeenCalled();
        const col = conn.getCollection('test');

        // call returns whatever our mock returns; type check at compile time that it is Collection<TestDoc>
        expect(collection).toHaveBeenCalledWith('test');
        expect(col).toBeDefined();
        expect(ctorUris).toEqual(['mongodb://localhost:27017']);
    });

    it('throws when getCollection called before connect', () => {
        const conn = new MongoDbConnection<Map>();

        expect(() => conn.getCollection('test')).toThrow(/not connected/);
    });

    it('throws when missing configuration and no override provided', async () => {
        const conn = new MongoDbConnection<Map>();

        await expect(conn.connect()).rejects.toThrow(/missing configuration/);
    });

    it('reuses client when URI unchanged; recreates when changed', async () => {
        const conn = new MongoDbConnection<Map>();

        await conn.connect({ connectionUri: 'mongodb://a', databaseName: 'db' });
        expect(ctorUris).toEqual(['mongodb://a']);
        await conn.connect({ connectionUri: 'mongodb://a', databaseName: 'db' });
        expect(ctorUris).toEqual(['mongodb://a']);
        await conn.connect({ connectionUri: 'mongodb://b', databaseName: 'db' });
        expect(ctorUris).toEqual(['mongodb://a', 'mongodb://b']);
    });

    it('throws with helpful message when db selection fails', async () => {
        const conn = new MongoDbConnection<Map>();

        dbShouldThrow = true;
        await expect(conn.connect({ connectionUri: 'mongodb://a', databaseName: 'dbX' })).rejects.toThrow(
            /failed to connect to database dbX/
        );
    });
});
