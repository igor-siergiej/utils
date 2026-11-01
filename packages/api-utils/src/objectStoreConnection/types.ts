import type { Readable } from 'node:stream';

import type { Client, ClientOptions } from 'minio';

/** The subset of the minio client that ObjectStoreConnection uses; the seam tests inject a fake through. */
export type ObjectStoreClient = Pick<Client, 'getObject' | 'statObject' | 'putObject' | 'listBuckets'>;

export type ObjectStoreClientFactory = (options: ClientOptions) => ObjectStoreClient;

export interface ObjectStoreConfig {
    endpoint: string;
    port?: number;
    accessKey: string;
    secretKey: string;
    bucketName: string;
}

export interface IBucket {
    getObjectStream: (id: string) => Promise<Readable>;
    getHeadObject: (id: string) => Promise<{ metaData?: Record<string, string> }>;
    putObject: (
        id: string,
        data: Buffer | Readable,
        meta?: { contentType?: string; metaData?: Record<string, string> }
    ) => Promise<void>;
    connect?: (config: ObjectStoreConfig) => Promise<void>;
}
