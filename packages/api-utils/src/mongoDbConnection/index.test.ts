import type * as mongodb from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MongoDbConnection } from './index';
import type { MongoClientFactory, MongoConfig } from './types';

interface TestDoc extends mongodb.Document {
    name: string;
}

type Map = Record<'test', TestDoc>;

const ctorUris: Array<string> = [];
let dbShouldThrow = false;
const connect = vi.fn();
const collection = vi.fn<(...args: Array<any>) => any>(() => ({ findOne: vi.fn() }));

const createClient: MongoClientFactory = (uri) => {
    ctorUris.push(uri);

    return {
        connect,
        db: () => {
            if (dbShouldThrow) throw new Error('fail create db');

            return { collection, command: vi.fn() };
        },
    };
};

describe('MongoDbConnection', () => {
    beforeEach(() => {
        connect.mockReset();
        collection.mockReset();
        ctorUris.length = 0;
        dbShouldThrow = false;
    });

    it('connects and returns typed collection', async () => {
        const cfg: MongoConfig = { connectionUri: 'mongodb://localhost:27017', databaseName: 'db' };
        const conn = new MongoDbConnection<Map>(createClient);

        await conn.connect(cfg);
        expect(connect).toHaveBeenCalled();
        const col = conn.getCollection('test');
        expect(collection).toHaveBeenCalledWith('test');
        expect(col).toBeDefined();
        expect(ctorUris).toEqual(['mongodb://localhost:27017']);
    });

    it('throws when getCollection called before connect', () => {
        const conn = new MongoDbConnection<Map>(createClient);
        expect(() => conn.getCollection('test')).toThrow(/not connected/);
    });

    it('throws when missing configuration and no override provided', async () => {
        const conn = new MongoDbConnection<Map>(createClient);
        await expect(conn.connect()).rejects.toThrow(/missing configuration/);
    });

    it('reuses client when URI unchanged; recreates when changed', async () => {
        const conn = new MongoDbConnection<Map>(createClient);
        await conn.connect({ connectionUri: 'mongodb://a', databaseName: 'db' });
        expect(ctorUris).toEqual(['mongodb://a']);
        await conn.connect({ connectionUri: 'mongodb://a', databaseName: 'db' });
        expect(ctorUris).toEqual(['mongodb://a']);
        await conn.connect({ connectionUri: 'mongodb://b', databaseName: 'db' });
        expect(ctorUris).toEqual(['mongodb://a', 'mongodb://b']);
    });

    it('throws with helpful message when db selection fails', async () => {
        const conn = new MongoDbConnection<Map>(createClient);
        dbShouldThrow = true;
        await expect(conn.connect({ connectionUri: 'mongodb://a', databaseName: 'dbX' })).rejects.toThrow(
            /failed to connect to database dbX/
        );
    });
});
