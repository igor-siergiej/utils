import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepoConfigError } from './errors';
import { loadRepoConfig } from './loader';
import { CONFIG_FILENAME } from './types';

let repoDir: string;

beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'kanban-cli-repoconfig-'));
});

afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
});

function writeConfig(contents: unknown) {
    writeFileSync(join(repoDir, CONFIG_FILENAME), typeof contents === 'string' ? contents : JSON.stringify(contents));
}

const VALID_CONFIG = {
    repoName: 'shoppingo',
    dev: {
        startCommand: 'docker compose up -d',
        healthCheckUrl: 'http://localhost:3000/health',
    },
    e2e: {
        testCommand: 'bun run test:e2e',
        smokeGrep: '@smoke',
    },
    ci: {
        workflowNames: ['CI/CD'],
    },
    deploy: {
        workflowName: 'Deploy',
    },
    environments: {
        staging: { baseUrl: 'https://staging.example.com' },
    },
    targetEnvironment: 'staging',
};

describe('loadRepoConfig', () => {
    it('reports configFound: false when no config file exists', () => {
        expect(loadRepoConfig(repoDir)).toEqual({ configFound: false });
    });

    it('loads and validates a complete config, applying defaults', () => {
        writeConfig(VALID_CONFIG);
        const result = loadRepoConfig(repoDir);

        expect(result.configFound).toBe(true);
        if (!result.configFound) throw new Error('expected configFound');

        expect(result.config.repoName).toBe('shoppingo');
        expect(result.config.dev.healthCheckTimeoutMs).toBe(60000);
        expect(result.config.dev.healthCheckIntervalMs).toBe(2000);
        expect(result.config.dev.teardownCommand).toBeUndefined();
        expect(result.config.e2e.configPath).toBe('playwright.config.ts');
        expect(result.config.ci.checkNamesRequired).toEqual([]);
        expect(result.config.deploy.timeoutMs).toBe(900000);
        expect(result.config.retryPolicy).toEqual({ implement: 3, e2e_local: 3, ci: 3, deploy: 2, e2e_live: 1 });
        expect(result.config.github).toEqual({ defaultBranch: 'main', mergeMethod: 'squash' });
    });

    it('applies explicit overrides on top of defaults', () => {
        writeConfig({
            ...VALID_CONFIG,
            retryPolicy: { ci: 5 },
            github: { mergeMethod: 'rebase' },
        });
        const result = loadRepoConfig(repoDir);
        if (!result.configFound) throw new Error('expected configFound');

        expect(result.config.retryPolicy).toEqual({ implement: 3, e2e_local: 3, ci: 5, deploy: 2, e2e_live: 1 });
        expect(result.config.github).toEqual({ defaultBranch: 'main', mergeMethod: 'rebase' });
    });

    it('throws RepoConfigError naming the missing field', () => {
        const { startCommand: _drop, ...devWithoutStart } = VALID_CONFIG.dev;
        writeConfig({ ...VALID_CONFIG, dev: devWithoutStart });

        expect(() => loadRepoConfig(repoDir)).toThrow(RepoConfigError);
        expect(() => loadRepoConfig(repoDir)).toThrow(/dev\.startCommand/);
    });

    it('throws when targetEnvironment is not defined in environments', () => {
        writeConfig({ ...VALID_CONFIG, targetEnvironment: 'production' });
        expect(() => loadRepoConfig(repoDir)).toThrow(/targetEnvironment/);
    });

    it('throws RepoConfigError on invalid JSON', () => {
        writeConfig('{ not valid json');
        expect(() => loadRepoConfig(repoDir)).toThrow(RepoConfigError);
    });

    it('throws when github.mergeMethod is not one of the allowed values', () => {
        writeConfig({ ...VALID_CONFIG, github: { mergeMethod: 'fast-forward' } });
        expect(() => loadRepoConfig(repoDir)).toThrow(/mergeMethod/);
    });
});
