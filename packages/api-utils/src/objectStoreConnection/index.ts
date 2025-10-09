import type { Readable } from 'node:stream';
import { Client } from 'minio';

import type { IBucket, ObjectStoreConfig } from './types';

export class ObjectStoreConnection implements IBucket {
    private client?: Client;
    private bucketName?: string;
    private lastEndpoint?: string;

    public async connect(config?: ObjectStoreConfig): Promise<void> {
        if (!config) {
            throw new Error('ObjectStoreConnection: missing configuration');
        }

        const { endpoint, port: explicitPort, accessKey, secretKey, bucketName } = config;

        if (!endpoint || !accessKey || !secretKey || !bucketName) {
            throw new Error('ObjectStoreConnection: incomplete configuration');
        }

        if (!this.client || endpoint !== this.lastEndpoint) {
            const [hostname, portStr] = endpoint.split(':');
            const port = explicitPort ?? (portStr ? parseInt(portStr, 10) : undefined);

            this.client = new Client({
                endPoint: hostname,
                port,
                useSSL: false,
                accessKey,
                secretKey,
            });
            this.lastEndpoint = endpoint;
        }

        this.bucketName = bucketName;
    }

    private requireConnection(): { client: Client; bucketName: string } {
        if (!this.client || !this.bucketName) {
            throw new Error('ObjectStoreConnection: not connected');
        }

        return { client: this.client, bucketName: this.bucketName };
    }

    public getObjectStream = async (id: string): Promise<Readable> => {
        const { client, bucketName } = this.requireConnection();

        return client.getObject(bucketName, id);
    };

    public getHeadObject = async (id: string) => {
        const { client, bucketName } = this.requireConnection();

        return client.statObject(bucketName, id);
    };

    public putObject = async (
        id: string,
        data: Buffer | Readable,
        meta?: { contentType?: string; metaData?: Record<string, string> }
    ): Promise<void> => {
        const { client, bucketName } = this.requireConnection();
        const size = Buffer.isBuffer(data) ? data.length : undefined;
        const metaHeaders: Record<string, string> = {};

        if (meta?.contentType) {
            metaHeaders['Content-Type'] = meta.contentType;
        }

        if (meta?.metaData) {
            for (const [key, value] of Object.entries(meta.metaData)) {
                metaHeaders[key] = value;
            }
        }

        if (Buffer.isBuffer(data)) {
            await client.putObject(bucketName, id, data, size, metaHeaders);
        } else {
            await client.putObject(bucketName, id, data, undefined, metaHeaders);
        }
    };

    public ping = async (): Promise<boolean> => {
        const { client } = this.requireConnection();

        try {
            await client.listBuckets();

            return true;
        } catch {
            return false;
        }
    };
}
