# @imapps/api-utils

Shared backend utilities for IM Apps Node/Bun API services. Built with tsup to CJS + ESM (`build/`).

## Install

```sh
bun add @imapps/api-utils
```

Runtime deps: `hono`, `minio`, `mongodb`.

## Entry points

### `@imapps/api-utils`

| Module | Exports | Notes |
| --- | --- | --- |
| `configService` | `ConfigService`, `ConfigError`, `getEnv`, `parsers`, `loadBaseConfig` | Reads `process.env`; `loadBaseConfig()` requires `PORT`, `CONNECTION_URI`, `DATABASE_NAME`. |
| `dependencyContainer` | `DependencyContainer` | Typed token → constructor/instance registry. |
| `logger` | `Logger` (implements `ILogger`) | |
| `mongoDbConnection` | `MongoDbConnection` | `connect(configOverride?)`, `ping()`. |
| `objectStoreConnection` | `ObjectStoreConnection` | MinIO client: `connect(config?)`, `getObjectStream`, `getHeadObject`, `putObject`, `ping`. |

### `@imapps/api-utils/hono`

| Export | Purpose |
| --- | --- |
| `createApp({ logger, allowedOrigins })` | Hono app with allow-listed CORS (credentials on), `requestLogger`, and `errorHandler` wired. |
| `requestLogger(logger)`, `RequestVariables` | Per-request logging middleware. |
| `errorHandler(logger?)`, `APIError`, `legacyErrorHandler` | `onError` handler; `legacyErrorHandler` is the no-logger variant kept for backwards compatibility. |

```ts
import { ConfigService, Logger, MongoDbConnection } from '@imapps/api-utils';
import { createApp } from '@imapps/api-utils/hono';
```

## Develop

```sh
bun run build        # tsup
bun run test         # vitest run --coverage
```

Consumers (from `package.json` scan): `packages/api` of shoppingo, kivo (root), mixtape, jewellery-catalogue, imapps-template.
