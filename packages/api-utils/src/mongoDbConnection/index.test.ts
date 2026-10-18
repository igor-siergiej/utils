// Mock the `mongodb` module so we can drive the constructor ourselves.
// In driver 7 the default MongoClient export is captured at module-load
// time, so `vi.spyOn(mongodb, 'MongoClient')` no longer intercepts
// `new MongoClient(...)` inside index.ts. Mocking the whole module makes
// every importer see the same mock.
import type * as mongodb from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MongoDbConnection } from './index';
import type { MongoConfig } from './types';

interface TestDoc extends mongodb.Document {
    name: string;
}
type Map = Record<'test', TestDoc>;

const ctorUris: Array<string> = [];
let dbShouldThrow = false;
const connect = vi.fn();
const collection = vi.fn(() => ({ findOne: vi.fn() }));

vi.mock('mongodb', async (importOriginal) => {
    const actual = await importOriginal<typeof mongodb>();
    const MongoClient = vi.fn().mockImplementation((uri: string) => {
        ctorUris.push(uri);
        return {
            connect,
            db: (_dbName: string) => {
                if (dbShouldThrow) throw new Error('fail create db');
                return { collection };
            },
        };
    });
    return { ...actual, MongoClient };
});

describe('MongoDbConnection', () => {
    beforeEach(() => {
        connect.mockReset();
        collection.mockReset();
        ctorUris.length = 0;
        dbShouldThrow = false;
    });

    it('connects and returns typed collection', async () => {
        const cfg: MongoConfig = { connectionUri: 'mongodb://localhost:27017', databaseName: 'db' };
        const conn = new MongoDbConnection<Map>();

        await conn.connect(cfg);
        expect(connect).toHaveBeenCalled();
        const col = conn.getCollection('test');
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
