export class ConfigError extends Error {
    constructor(variable: string) {
        super(`Environment variable '${variable}' is missing`);
        this.name = 'ConfigError';
    }
}

export type EnvParser<T> = (raw: string) => T;

export const parsers = {
    string: (v: string) => v,
    number: (v: string) => {
        const n = Number(v);

        if (Number.isNaN(n)) throw new Error(`Expected number, received '${v}'`);

        return n;
    },
    boolean: (v: string) => v === 'true',
    json: <T>(v: string): T => JSON.parse(v),
};

export function getEnv(key: string, parser?: undefined, fallback?: string): string;
export function getEnv<T>(key: string, parser: EnvParser<T>, fallback?: T): T;
export function getEnv<T>(
    key: string,
    parser: EnvParser<T | string> = parsers.string,
    fallback?: T | string
): T | string {
    const raw = process.env[key];

    if (raw === undefined || raw === '') {
        if (fallback !== undefined) return fallback;
        throw new ConfigError(key);
    }

    return parser(raw);
}

export interface BaseConfig {
    PORT: number;
    CONNECTION_URI: string;
    DATABASE_NAME: string;
}

export function loadBaseConfig(): BaseConfig {
    return {
        PORT: getEnv('PORT', parsers.number),
        CONNECTION_URI: getEnv('CONNECTION_URI', parsers.string),
        DATABASE_NAME: getEnv('DATABASE_NAME', parsers.string),
    };
}

export interface SchemaEntry<T> {
    parser: EnvParser<T>;
    default?: T;
    optional?: boolean;
    from?: string;
}

export type ConfigSchema = Record<string, SchemaEntry<unknown>>;

type InferConfig<S extends ConfigSchema> = {
    [K in keyof S]: S[K] extends SchemaEntry<infer T> ? (S[K]['optional'] extends true ? T | undefined : T) : never;
};

function resolveEntry(key: string, entry: SchemaEntry<unknown>) {
    const envKey = entry.from ?? key;
    const raw = process.env[envKey];

    if (raw !== undefined && raw !== '') return entry.parser(raw);

    if ('default' in entry) return entry.default;

    if (entry.optional) return undefined;

    throw new ConfigError(envKey);
}

export class ConfigService<S extends ConfigSchema> {
    public readonly values: InferConfig<S>;

    constructor(schema: S) {
        const resolved = Object.fromEntries(
            Object.entries(schema).map(([key, entry]) => [key, resolveEntry(key, entry)])
        );

        // SAFETY: resolved holds exactly the keys of schema, each produced by that entry's parser, default, or undefined when optional, which is what InferConfig<S> describes.
        this.values = resolved as InferConfig<S>;
    }

    get<K extends keyof InferConfig<S>>(key: K): InferConfig<S>[K] {
        return this.values[key];
    }
}
