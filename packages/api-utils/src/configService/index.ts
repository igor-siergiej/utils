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
    json: <T>(v: string) => JSON.parse(v) as T,
};

export function getEnv<T = string>(key: string, parser: EnvParser<T> = parsers.string as EnvParser<T>, fallback?: T): T {
    const raw = process.env[key];

    if (raw === undefined || raw === null || raw === '') {
        if (fallback !== undefined) return fallback;
        throw new ConfigError(key);
    }

    return parser(raw);
}

export interface BaseConfigShape {
    PORT: number;
    CONNECTION_URI: string;
    DATABASE_NAME: string;
}

export function loadBaseConfig(): BaseConfigShape {
    return {
        PORT: getEnv('PORT', parsers.number),
        CONNECTION_URI: getEnv('CONNECTION_URI', parsers.string),
        DATABASE_NAME: getEnv('DATABASE_NAME', parsers.string),
    };
}

export interface SchemaEntry<T> { parser: EnvParser<T>; default?: T; optional?: boolean; from?: string }
export type ConfigSchema = Record<string, SchemaEntry<unknown>>;

type InferConfig<S extends ConfigSchema> = {
    [K in keyof S]: S[K] extends SchemaEntry<infer T>
        ? (S[K]['optional'] extends true ? T | undefined : T)
        : never
};

export class ConfigService<S extends ConfigSchema> {
    public readonly values: InferConfig<S>;

    constructor(schema: S) {
        const result: Partial<InferConfig<S>> = {};

        for (const key of Object.keys(schema) as Array<keyof S>) {
            const entry = schema[key];
            const envKey = entry.from ?? (key as string);
            const raw = process.env[envKey];

            if (raw === undefined || raw === null || raw === '') {
                if ('default' in entry) {
                    result[key as keyof InferConfig<S>] = entry.default as InferConfig<S>[keyof InferConfig<S>];
                } else if (entry.optional) {
                    result[key as keyof InferConfig<S>] = undefined as unknown as InferConfig<S>[keyof InferConfig<S>];
                } else {
                    throw new ConfigError(envKey);
                }
            } else {
                const parsed = entry.parser(raw as string) as InferConfig<S>[keyof InferConfig<S>];

                result[key as keyof InferConfig<S>] = parsed;
            }
        }

        this.values = result as InferConfig<S>;
    }

    get<K extends keyof InferConfig<S>>(key: K): InferConfig<S>[K] {
        return this.values[key];
    }
}
