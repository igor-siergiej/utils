# im-apps-utils

Shared utilities monorepo for IM Apps projects.

Packages:
- @imapps/api-utils — utilities for Node/API services
- @imapps/web-utils — utilities for frontend web apps

## Development

- Build all packages:

```bash
yarn build
```

## Publishing

Publishing is automated via GitLab CI/CD (manual button).

- Where: GitLab CI/CD → After CI passes → Manual "publish" button
- What it does (high level):
  - Uses current version from `package.json` files
  - Builds all workspaces
  - Publishes all non-private workspaces to GitLab Package Registry in topological order
  - Uses `--tolerate-republish` to handle already-published versions

Required repository configuration:
- Uses `CI_JOB_TOKEN` which is automatically provided by GitLab CI/CD

Notes:
- Registry is GitLab Package Registry and is configured via `publishConfig` in each package.json
- Dist-tag defaults to `latest`

### Manual local publish (optional)

If you need to publish locally instead of CI, you can still run:

```bash
# from repo root
cd packages/api-utils && yarn version patch && yarn npm publish
cd ../web-utils && yarn version patch && yarn npm publish
```

## Usage

Install in consumers (e.g. Shoppingo, jewellery-catalogue, kivo):

```bash
yarn add @imapps/api-utils @imapps/web-utils
```

Then import:

```ts
import { createPaginatedResponse } from '@imapps/api-utils';
import { cn } from '@imapps/web-utils';
```


# Workflows test - Mon  9 Mar 13:14:38 GMT 2026
