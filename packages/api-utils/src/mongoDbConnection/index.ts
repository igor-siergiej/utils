import { type Collection, type Db, type Document, MongoClient } from 'mongodb';

import type { MongoClientFactory, MongoClientLike, MongoConfig } from './types';

export class MongoDbConnection<CMap extends Record<string, Document> = Record<string, Document>> {
    private client?: MongoClientLike;
    private databaseInstance?: Pick<Db, 'collection'>;
    private config?: MongoConfig;

    constructor(private readonly createClient: MongoClientFactory = (uri) => new MongoClient(uri)) {}

    public async connect(configOverride?: MongoConfig): Promise<void> {
        const cfg = configOverride ?? this.config;

        if (!cfg) {
            throw new Error('MongoDbConnection: missing configuration');
        }

        if (!this.client || (configOverride && configOverride.connectionUri !== this.config?.connectionUri)) {
            this.config = cfg;
            this.client = this.createClient(cfg.connectionUri);
        }

        await this.client.connect();

        try {
            this.databaseInstance = this.client.db(cfg.databaseName);
        } catch (e) {
            throw new Error(`MongoDbConnection: failed to connect to database ${cfg.databaseName}`, { cause: e });
        }
    }

    public getCollection<K extends keyof CMap & string>(collectionName: K): Collection<CMap[K]> {
        if (!this.databaseInstance) {
            throw new Error('MongoDbConnection: not connected');
        }

        return this.databaseInstance.collection<CMap[K]>(collectionName);
    }

    public async ping(): Promise<boolean> {
        if (!this.client) {
            throw new Error('MongoDbConnection: not connected');
        }

        try {
            await this.client.db().command({ ping: 1 });

            return true;
        } catch {
            return false;
        }
    }
}
