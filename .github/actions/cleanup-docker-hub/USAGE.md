# Docker Hub Cleanup Action

Automatically clean up old Docker image tags from Docker Hub after release.

## Usage

Add to your release workflow after the docker build/push step:

```yaml
- name: Cleanup old Docker images
  uses: igurusama/utils/.github/actions/cleanup-docker-hub@main
  with:
    image: igurusama/your-app-name
  env:
    DOCKER_USERNAME: ${{ secrets.DOCKER_USERNAME }}
    DOCKER_PASSWORD: ${{ secrets.DOCKER_PASSWORD }}
```

## Inputs

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `image` | Docker Hub image name (e.g., `igurusama/sentinel-web`) | - | Yes |
| `keep-count` | Number of latest versions to keep | `5` | No |

## Environment Variables

- `DOCKER_USERNAME` - Docker Hub username
- `DOCKER_PASSWORD` - Docker Hub password or token

## Behavior

1. Authenticates with Docker Hub API v2
2. Lists all tags matching semver format (e.g., `1.2.3`)
3. Sorts by version (newest first)
4. Keeps the latest N versions (default: 5)
5. Always preserves the `latest` tag
6. Deletes all other older versions

## Example

If your image has tags: `1.5.0`, `1.4.5`, `1.4.4`, `1.4.3`, `1.4.2`, `1.4.1`, `1.3.0`, `latest`

With `keep-count: 5`, it will:
- **Keep:** `1.5.0`, `1.4.5`, `1.4.4`, `1.4.3`, `1.4.2`, `latest`
- **Delete:** `1.4.1`, `1.3.0`

## Non-blocking

Cleanup failures do not block the release. The action logs warnings but exits successfully.
