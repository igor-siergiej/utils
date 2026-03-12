# CI/CD Pipelines

Shared pipeline scripts and configurations for building and publishing Docker images across all services (shoppingo, kivo, jewellery-catalogue).

## Usage

### From GitHub Actions Workflows

Add utils as a submodule in your service repo:
```bash
git submodule add https://github.com/igor-siergiej/utils .github/workflows-utils
```

In your `.github/workflows/ci-cd.yml`:
```yaml
- name: Publish Docker images
  run: .github/workflows-utils/pipelines/scripts/publish-images.sh ${{ github.event.repository.name }} ${{ env.VERSION }}
  env:
    DOCKER_USERNAME: ${{ secrets.DOCKER_USERNAME }}
    DOCKER_PASSWORD: ${{ secrets.DOCKER_PASSWORD }}
    NODE_AUTH_TOKEN: ${{ secrets.GH_TOKEN }}
```

## Scripts

### `extract-version.sh`
Extracts version from `package.json` and outputs as GitHub Actions variable.

**Usage:**
```bash
source ./extract-version.sh
echo $VERSION
```

### `docker-build.sh`
Builds and pushes a single Docker image.

**Usage:**
```bash
./docker-build.sh <service-name> <version> <dockerfile-path> <base-tag>
```

**Example:**
```bash
./docker-build.sh kivo 1.7.1 ./Dockerfile kivo
./docker-build.sh shoppingo 1.20.4 ./Dockerfile.api shoppingo-api
```

### `publish-images.sh`
Orchestrates building and pushing all images for a service based on config.

**Usage:**
```bash
./publish-images.sh <service-name> <version>
```

**Config Location:** `config/<service-name>.json`

## Configuration

Service configs are JSON files in `config/` directory. Format:
```json
{
  "service": "service-name",
  "dockerfiles": [
    {
      "dockerfile": "./Dockerfile.api",
      "tag": "service-api"
    }
  ]
}
```

- `dockerfile`: Path to Dockerfile relative to repo root
- `tag`: Base tag name (e.g., `kivo`, `shoppingo-api`); version and `-latest` suffix are added automatically

**Generated tags:**
- `igurusama/imapps:{tag}-{version}`
- `igurusama/imapps:{tag}-latest`
