# GitHub Secrets Setup Guide

This document explains which GitHub secrets are required for each repository to enable GitHub Actions CI/CD workflows.

## Required Secrets

### For All Repos (sentinel, shoppingo, kivo, jewellery-catalogue, utils)

**DOCKER_USERNAME**
- Value: Your Docker Hub username (e.g., `igurusama`)
- Purpose: Used by build-publish.yml to authenticate with Docker Hub when pushing images
- How to create: GitHub repo Settings → Secrets and variables → Actions → New repository secret

**DOCKER_PASSWORD**
- Value: Docker Hub personal access token (NOT your password)
- Purpose: Used as password for Docker Hub authentication
- How to create:
  1. Go to https://hub.docker.com/settings/security/tokens
  2. Create a "New access token"
  3. Copy the token
  4. Add to GitHub as secret

### For utils Repo Only

**NPM_TOKEN**
- Value: npm personal access token with publish permission
- Purpose: Used by npm-publish.yml to authenticate with npm registry when publishing packages
- How to create:
  1. Go to https://npmjs.com/ and sign in
  2. Click your profile → Access Tokens
  3. Create a "Granular Access Token"
  4. Set permissions: "Publish" for packages
  5. Copy the token
  6. Add to GitHub as secret

## Setup Instructions

### Step 1: Add secrets to each repo

For each repository (sentinel, shoppingo, kivo, jewellery-catalogue, utils):

1. Go to GitHub repo page: https://github.com/igor-siergiej/[REPO_NAME]
2. Click Settings (gear icon)
3. Left sidebar: Secrets and variables → Actions
4. Click "New repository secret"
5. Add secrets:
   - Name: `DOCKER_USERNAME`, Value: `igurusama`
   - Name: `DOCKER_PASSWORD`, Value: [your Docker Hub token]

### Step 2: Add NPM_TOKEN to utils only

1. Go to https://github.com/igor-siergiej/utils
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `NPM_TOKEN`, Value: [your npm token]

## Verification

After adding secrets:

1. Push a test commit to verify lint-test.yml runs: `git push origin main`
2. Check GitHub Actions tab to see workflow execution
3. On version tag, verify build-publish.yml runs: `git tag v0.0.1-test && git push origin --tags`

## Troubleshooting

**Docker authentication fails:**
- Verify DOCKER_USERNAME and DOCKER_PASSWORD are correct
- Check that Docker Hub token has push permissions
- Ensure token is not expired

**npm publish fails:**
- Verify NPM_TOKEN is correct
- Check that token has publish permission
- Verify package versions match in package.json

**Workflows not triggering:**
- Ensure .github/workflows/ files are committed
- Push to main branch (not other branches)
- Check that files don't have syntax errors
