import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoConfigError } from './errors';
import { loadRepoConfig } from './loader';
import { scaffoldRepoConfig } from './scaffold';
import { CONFIG_FILENAME } from './types';

let repoDir: string;

beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'kanban-cli-scaffold-'));
});

afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
});

const write = (path: string, contents: unknown) => {
    const full = join(repoDir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents));
};

const written = () => JSON.parse(readFileSync(join(repoDir, CONFIG_FILENAME), 'utf8'));

const CI_WORKFLOW = 'name: CI\non:\n  pull_request:\n  push:\n    branches: [main]\njobs: {}\n';
const DEPLOY_WORKFLOW = 'name: CD\non:\n  push:\n    branches: [main]\njobs: {}\n';

function fullRepo() {
    write('package.json', {
        name: '@imapps/shoppingo',
        packageManager: 'bun@1.3.0',
        scripts: { dev: 'vite', 'test:e2e': 'playwright test' },
        devDependencies: { vite: '^6.0.0' },
    });
    write('playwright.config.ts', 'export default {};');
    write('.github/workflows/ci.yml', CI_WORKFLOW);
    write('.github/workflows/deploy.yml', DEPLOY_WORKFLOW);
}

describe('scaffoldRepoConfig', () => {
    it('infers a complete, loadable config from a typical repo plus a base URL', () => {
        fullRepo();

        const result = scaffoldRepoConfig(repoDir, { baseUrl: 'https://shoppingo.example.com' });

        expect(result).toMatchObject({ written: true, missing: [], valid: true });
        expect(written()).toEqual({
            repoName: 'shoppingo',
            dev: { startCommand: 'bun run dev', healthCheckUrl: 'http://localhost:5173' },
            e2e: {
                framework: 'playwright',
                testCommand: 'bun run test:e2e',
                smokeGrep: '@smoke',
                configPath: 'playwright.config.ts',
            },
            ci: { workflowNames: ['CI'] },
            deploy: { workflowName: 'CD' },
            environments: { production: { baseUrl: 'https://shoppingo.example.com' } },
            targetEnvironment: 'production',
        });
        expect(loadRepoConfig(repoDir).configFound).toBe(true);
    });

    it('reports what it could not infer instead of writing placeholders', () => {
        write('package.json', { name: 'lib' });

        const result = scaffoldRepoConfig(repoDir);

        expect(result.valid).toBe(false);
        expect(result.missing).toEqual([
            'dev.startCommand',
            'ci.workflowNames',
            'deploy.workflowName',
            'environments',
            'targetEnvironment',
        ]);
        expect(written().e2e.testCommand).toBe('npx playwright test');
    });

    it('keeps every value an existing partial config already has', () => {
        fullRepo();
        write(CONFIG_FILENAME, { repoName: 'custom', dev: { healthCheckUrl: 'http://localhost:8080/health' } });

        const result = scaffoldRepoConfig(repoDir, { baseUrl: 'https://x.example.com' });

        expect(written().repoName).toBe('custom');
        expect(written().dev).toEqual({ healthCheckUrl: 'http://localhost:8080/health', startCommand: 'bun run dev' });
        expect(result.inferred).toContain('dev.startCommand');
        expect(result.inferred).not.toContain('repoName');
        expect(result.inferred).not.toContain('dev.healthCheckUrl');
    });

    it('does not rewrite the file when nothing new was inferred', () => {
        fullRepo();
        scaffoldRepoConfig(repoDir, { baseUrl: 'https://x.example.com' });
        const before = readFileSync(join(repoDir, CONFIG_FILENAME), 'utf8');

        const result = scaffoldRepoConfig(repoDir);

        expect(result).toMatchObject({ written: false, inferred: [], valid: true });
        expect(readFileSync(join(repoDir, CONFIG_FILENAME), 'utf8')).toBe(before);
    });

    it('never merges a guessed environment into existing environments', () => {
        fullRepo();
        write(CONFIG_FILENAME, { environments: { staging: { baseUrl: 'https://staging.example.com' } } });

        scaffoldRepoConfig(repoDir, { baseUrl: 'https://prod.example.com' });

        expect(written().environments).toEqual({ staging: { baseUrl: 'https://staging.example.com' } });
    });

    it('uses --repo-name, --environment and the package.json homepage', () => {
        write('package.json', { name: 'pkg', homepage: 'https://pkg.example.com' });

        scaffoldRepoConfig(repoDir, { repoName: 'override', environment: 'staging' });

        expect(written()).toMatchObject({
            repoName: 'override',
            environments: { staging: { baseUrl: 'https://pkg.example.com' } },
            targetEnvironment: 'staging',
        });
    });

    it('falls back to the directory name without a package.json', () => {
        scaffoldRepoConfig(repoDir);

        expect(written().repoName).toBe(basename(repoDir));
    });

    it.each([
        ['pnpm-lock.yaml', 'pnpm run start', 'pnpm exec playwright test'],
        ['yarn.lock', 'yarn run start', 'yarn playwright test'],
        ['bun.lockb', 'bun run start', 'bunx playwright test'],
    ])('detects the package manager from %s', (lockfile, startCommand, testCommand) => {
        write('package.json', { scripts: { start: 'node server.js' } });
        write(lockfile, '');

        scaffoldRepoConfig(repoDir);

        expect(written().dev.startCommand).toBe(startCommand);
        expect(written().e2e.testCommand).toBe(testCommand);
    });

    it('only counts workflows that run on pull requests as CI', () => {
        write('.github/workflows/a.yml', 'name: Lint\non: [push, pull_request]\njobs: {}\n');
        write('.github/workflows/b.yml', 'name: Nightly\non:\n  schedule:\n    - cron: "0 0 * * *"\njobs: {}\n');
        write('.github/workflows/c.yaml', 'on: pull_request\njobs: {}\n');
        write('.github/workflows/broken.yml', 'name: [unclosed');

        scaffoldRepoConfig(repoDir);

        expect(written().ci).toEqual({ workflowNames: ['Lint', 'c.yaml'] });
    });

    it('refuses to touch an existing file that is not a JSON object', () => {
        write(CONFIG_FILENAME, '{ not json');

        expect(() => scaffoldRepoConfig(repoDir)).toThrow(RepoConfigError);
        expect(readFileSync(join(repoDir, CONFIG_FILENAME), 'utf8')).toBe('{ not json');
    });
});
