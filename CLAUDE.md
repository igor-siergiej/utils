# IM Apps Utils - Shared Utilities Monorepo - Claude Code Context

## Project Overview
im-apps-utils is a shared utilities monorepo containing common code, pipelines, and infrastructure utilities used across all IM Apps projects (shoppingo, kivo, jewellery-catalogue, etc.). It provides reusable components to maintain consistency and reduce code duplication.

## Architecture
- **Monorepo Structure**: Yarn 4 workspaces with shared linting and build configuration
- **Publishing**: Automated GitLab Package Registry publishing via GitLab CI/CD
- **Build System**: TypeScript + tsup for dual CommonJS/ESM builds
- **Testing**: Vitest with coverage reporting
- **Registry**: GitLab Package Registry (`https://gitlab.com/api/v4/packages/npm/`)

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
│   │   │   └── objectStoreConnection/ # MinIO/S3 object storage utilities
│   │   └── package.json
│   └── web-utils/           # Frontend utilities for React apps
│       ├── src/
│       │   └── index.ts    # Class name utilities, browser detection, math helpers
│       └── package.json
├── .gitlab-ci.yml         # GitLab CI/CD pipeline
│   # Includes: CI checks, package publishing, Docker builds, GitOps updates
├── build/                 # Build output directory
├── package.json          # Root workspace configuration
└── README.md            # Comprehensive documentation
```

## Published Packages

### @imapps/api-utils (v0.0.9)
Backend utilities for Node.js/API services:

**Key Features:**
- **configService**: Environment configuration management with validation
- **dependencyContainer**: Lightweight dependency injection system
- **logger**: Structured logging with different log levels
- **mongoDbConnection**: MongoDB connection utilities with error handling
- **objectStoreConnection**: MinIO/S3 object storage helpers

**Dependencies:**
- `mongodb` - MongoDB native driver
- `minio` - MinIO client for object storage

**Usage Example:**
```ts
import {
    createMongoDbConnection,
    createObjectStoreConnection,
    DependencyContainer,
    Logger
} from '@imapps/api-utils';
```

### @imapps/web-utils (v0.0.9)
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

## Development Workflow

### Key Scripts (run from root)
- `yarn build` - Build all packages
- `yarn clean` - Clean all build outputs
- `yarn lint` - Run ESLint across all packages
- `yarn lint:fix` - Auto-fix ESLint issues

### Package-specific Scripts
- `yarn workspace @imapps/api-utils test` - Run tests with coverage
- `yarn workspace @imapps/api-utils test:watch` - Watch mode testing

## Publishing & CI/CD

### Automated Publishing (Recommended)
Publishing is fully automated via GitLab CI/CD:

1. **Trigger**: Manual job from GitLab CI/CD → "publish" → Run manually
2. **Process**:
   - Auto-derives next patch version from latest `v*` tag
   - Updates all package.json versions and commits changes
   - Builds all workspaces
   - Publishes to GitLab Package Registry in topological order
   - Creates and pushes git tag only if all publishes succeed

### Required Variables
- `CI_JOB_TOKEN`: Automatically provided by GitLab CI/CD for package publishing

### Manual Local Publishing (Alternative)
```bash
# From repo root
cd packages/api-utils && yarn version patch && yarn npm publish
cd ../web-utils && yarn version patch && yarn npm publish
```

## CI/CD Pipelines

### GitLab CI/CD Pipeline
- **ci stage**: Lint, typecheck, and automated testing
- **publish stage**: Automated package publishing with version management
- **build stage**: Docker image building for containerized deployments
- **deploy stage**: GitOps deployment automation and production deployment

## Consumer Integration

### Installation in Projects
```bash
# Add to package.json dependencies
yarn add @imapps/api-utils @imapps/web-utils
```

### Current Usage
- **shoppingo**: Uses `@imapps/api-utils` in the API package
- **kivo**: Could benefit from shared API utilities for common patterns
- **jewellery-catalogue**: Potential consumer of both packages

## Configuration Requirements

### Registry Setup (.yarnrc.yml)
```yaml
npmScopes:
  imapps:
    npmRegistryServer: "https://gitlab.com/api/v4/projects/${CI_PROJECT_ID}/packages/npm/"
```

### Authentication
Requires GitLab access token with packages:read permission for installation.

## Development Standards
- **TypeScript**: Strict configuration with full type safety
- **ESLint**: Shared configuration with import sorting and unused import detection
- **Build**: Dual CommonJS/ESM output via tsup
- **Testing**: Vitest with coverage reporting for api-utils
- **Versioning**: Semantic versioning with automated patch bumps

## Useful Commands for Claude
- **Build all packages**: `yarn build`
- **Test API utilities**: `yarn workspace @imapps/api-utils test`
- **Check package structure**: Main exports in each `src/index.ts`
- **Lint all code**: `yarn lint`
- **Package status**: Check `build/` directories after building

## GitOps Integration
The repository includes CI/CD pipelines that integrate with the deployment infrastructure:
- **docker-build job**: Builds container images for utilities that need containerization
- **gitops-update job**: Updates Kubernetes manifests in the `argonaut` GitOps repository
- **Integration**: Works with ArgoCD for automated deployment of utility services
- **GitLab Integration**: Uses GitLab CI/CD tokens for seamless access to argonaut repository
- See `../argonaut/CLAUDE.md` for GitOps deployment infrastructure documentation

## Related Services
- **Primary Consumers**: `shoppingo`, `kivo`, `jewellery-catalogue` applications
- **GitOps Deployment**: Container builds integrated with `argonaut` Kubernetes GitOps
- **Registry**: Published packages available to all services in the IM Apps GitLab group
- See individual service CLAUDE.md files for specific integration details

## Integration Notes
This monorepo serves as the foundation for shared functionality across the IM Apps ecosystem. When working on shoppingo, kivo, or other projects, consider whether new utilities should be added here for reuse across projects. Container-based utilities can be deployed via the GitLab CI/CD pipeline to the Kubernetes cluster managed through the GitOps workflow.