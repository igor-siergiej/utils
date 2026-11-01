# IM Apps Utils - Shared Utilities Monorepo - Claude Code Context

## Project Overview
im-apps-utils is a shared utilities monorepo containing common code and infrastructure utilities used across all IM Apps projects (shoppingo, kivo, jewellery-catalogue, etc.). It provides reusable components to maintain consistency and reduce code duplication.

## Architecture
- **Monorepo Structure**: Bun workspaces with shared linting and build configuration
- **Publishing**: Automated GitHub Actions publishing to npmjs.org
- **Build System**: TypeScript + tsup for dual CommonJS/ESM builds
- **Testing**: Vitest with coverage reporting
- **Linting**: Oxlint (lint, with the vendored anti-slop rules) + Oxfmt (formatting), shared via `@imapps/oxc-config`
- **Registry**: npmjs.org (`https://registry.npmjs.org/`)

## Project Structure
```
im-apps-utils/
├── packages/
│   ├── api-utils/           # Backend utilities for Node.js services
│   │   ├── src/
│   │   │   ├── configService/      # Environment configuration management
│   │   │   ├── dependencyContainer/ # Dependency injection container
│   │   │   ├── logger/             # Structured logging utilities
│   │   │   ├── mongoDbConnection/  # MongoDB connection helpers
│   │   │   └── objectStoreConnection/ # S3-compatible object storage utilities
│   │   └── package.json
│   ├── biome-config/        # Deprecated shared Biome configuration (kept published)
│   │   └── configs/base.json
│   ├── oxc-config/          # Shared Oxlint + Oxfmt configuration with vendored anti-slop rules
│   │   ├── src/            # oxlint/oxfmt presets (built to build/)
│   │   └── anti-slop/      # Vendored upstream plugin; never edit, lint or format it
│   └── web-utils/           # Frontend utilities for React apps
│       ├── src/
│       │   └── index.ts    # Class name utilities, browser detection, math helpers
│       └── package.json
├── .github/workflows/      # GitHub Actions CI/CD pipelines
├── build/                  # Build output directory
├── package.json           # Root workspace configuration
└── README.md             # Comprehensive documentation
```

## Published Packages

### @imapps/api-utils
Backend utilities for Node.js/API services:

**Key Features:**
- **configService**: Environment configuration management with validation
- **dependencyContainer**: Lightweight dependency injection system
- **logger**: Structured logging with different log levels
- **mongoDbConnection**: MongoDB connection utilities with error handling
- **objectStoreConnection**: S3-compatible object store (RustFS) helpers

**Dependencies:**
- `mongodb` - MongoDB native driver
- `minio` - S3 client library (talks to the RustFS object store)

**Usage Example:**
```ts
import {
    createMongoDbConnection,
    createObjectStoreConnection,
    DependencyContainer,
    Logger
} from '@imapps/api-utils';
```

### @imapps/web-utils
Frontend utilities for React/web applications:

**Key Features:**
- **cn()**: Class name utility function (similar to clsx/classnames)
- **isBrowser()**: Browser environment detection
- **clamp()**: Mathematical clamping utility

**Usage Example:**
```ts
import { cn, isBrowser, clamp } from '@imapps/web-utils';

const className = cn('base-class', isActive && 'active', { 'hover': isHovered });
const inBrowser = isBrowser();
const clampedValue = clamp(value, 0, 100);
```

### @imapps/oxc-config
Shared Oxlint and Oxfmt configuration, with the [anti-slop](https://github.com/dmmulroy/anti-slop) rules vendored in `anti-slop/`. Exports `./oxlint` (spread into `defineConfig` in `oxlint.config.ts`), `./oxfmt` (re-exported from `oxfmt.config.ts`) and `./anti-slop` (the plugin). It ships built JS, so `bun run build:config` (run automatically by `lint`, `lint:fix`, `format` and the pre-commit hook) must build it before Oxlint can load the plugin.

### @imapps/biome-config (deprecated)
Shared Biome configuration. Superseded by `@imapps/oxc-config`; still published for repos that have not migrated.

## Development Workflow

### Key Scripts (run from root)
- `bun run build` - Build all packages
- `bun run clean` - Clean all build outputs
- `bun run lint` - Build `@imapps/oxc-config`, then `oxlint && oxfmt --check`
- `bun run lint:fix` - Auto-fix with `oxlint --fix`, format with `oxfmt`, then re-lint
- `bun run format` - Format code with Oxfmt (code and JSON only; Markdown/YAML are not formatted)
- `bun run build:config` - Build only `@imapps/oxc-config` (the Oxlint plugin and presets)

Run `bun run lint:fix` before finishing; fix anti-slop violations, never suppress them.

### Package-specific Scripts
- `bun run --filter '@imapps/api-utils' test` - Run tests with coverage
- `bun run --filter '@imapps/api-utils' test:watch` - Watch mode testing

## Publishing & CI/CD

### Automated Publishing
Publishing is fully automated via GitHub Actions:

1. **Trigger**: Push to main branch or manual GitHub release
2. **Process**:
   - GitHub Actions runs semantic-release via `bunx semantic-release`
   - Auto-derives next version from commit messages (conventional commits)
   - Updates all package.json versions and commits changes
   - Builds all workspaces
   - Publishes to npmjs.org in topological order
   - Creates and pushes git tag only if all publishes succeed

### Required Setup
- GitHub repository with write permissions for CI
- npm token configured as GitHub secret `NPM_TOKEN` for package publishing

## CI/CD Pipelines

### GitHub Actions Workflows
- **ci-cd.yml**: Main CI pipeline - lint, typecheck, and automated testing
- **reusable-lint-test.yml**: Reusable workflow for linting and testing
- **reusable-release.yml**: Reusable workflow for semantic-release publishing
- **reusable-docker-build-publish.yml**: Docker image building and publishing

## Consumer Integration

### Installation in Projects
```bash
# Add to package.json dependencies
bun add @imapps/api-utils @imapps/web-utils
```

### Current Usage
- **shoppingo**: Uses `@imapps/api-utils` in the API package
- **kivo**: Could benefit from shared API utilities for common patterns
- **jewellery-catalogue**: Potential consumer of both packages

## Development Standards
- **TypeScript**: Strict configuration with full type safety
- **Oxlint + Oxfmt**: Shared configuration (`@imapps/oxc-config`) for linting (incl. anti-slop rules), formatting, and import sorting
- **Build**: Dual CommonJS/ESM output via tsup
- **Testing**: Vitest with coverage reporting for api-utils
- **Package Manager**: Bun for fast, reliable dependency management
- **Versioning**: Semantic versioning with automated patch bumps via semantic-release

## Useful Commands for Claude
- **Build all packages**: `bun run build`
- **Test API utilities**: `bun run --filter '@imapps/api-utils' test`
- **Check package structure**: Main exports in each `src/index.ts`
- **Lint all code**: `bun run lint`
- **Auto-fix linting issues**: `bun run lint:fix`
- **Package status**: Check `build/` directories after building

## Related Services
- **Primary Consumers**: `shoppingo`, `kivo`, `jewellery-catalogue` applications
- **Registry**: Published packages available on npmjs.org to all services
- **CI/CD**: GitHub Actions orchestrates testing and publishing
