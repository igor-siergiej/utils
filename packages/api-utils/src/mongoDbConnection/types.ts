import type { Db, MongoClient } from 'mongodb';

/** The subset of the Mongo client that MongoDbConnection uses; the seam tests inject a fake through. */
export interface MongoClientLike extends Pick<MongoClient, 'connect'> {
    db: (name?: string) => Pick<Db, 'collection' | 'command'>;
}

export type MongoClientFactory = (uri: string) => MongoClientLike;

export interface MongoConfig {
    connectionUri: string;
    databaseName: string;
}
