import type { Readable } from 'node:stream';

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
