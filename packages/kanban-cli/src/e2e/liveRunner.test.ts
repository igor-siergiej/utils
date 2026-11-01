import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoConfig } from '../repoConfig/types';
import { type LiveE2eDeps, runLiveSmoke } from './liveRunner';

const config: RepoConfig = {
    repoName: 'app',
    dev: {
        startCommand: 'bun dev',
        healthCheckUrl: 'http://localhost:3000',
        healthCheckTimeoutMs: 1,
        healthCheckIntervalMs: 1,
    },
    e2e: {
        framework: 'playwright',
        testCommand: 'bunx playwright test',
        smokeGrep: '@smoke',
        configPath: 'playwright.config.ts',
    },
    ci: { workflowNames: [], checkNamesRequired: [] },
    deploy: { workflowName: 'Deploy', timeoutMs: 1, pollIntervalMs: 1 },
    environments: { production: { baseUrl: 'https://app.example.com' } },
    targetEnvironment: 'production',
    retryPolicy: { implement: 3, e2e_local: 3, ci: 3, deploy: 2, e2e_live: 1 },
    github: { defaultBranch: 'main', mergeMethod: 'squash' },
};

const runShell = vi.fn<LiveE2eDeps['runShell']>();
const deps = { runShell } satisfies LiveE2eDeps;

beforeEach(() => {
    vi.clearAllMocks();
    runShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

describe('runLiveSmoke', () => {
    it('scopes to the smoke grep and points tests at the live URL with CI stripped', async () => {
        const result = await runLiveSmoke('/repo', config, 'https://app.example.com', {}, deps);

        expect(runShell).toHaveBeenCalledOnce();
        expect(runShell).toHaveBeenCalledWith('bunx playwright test --grep "@smoke"', {
            cwd: '/repo',
            env: { E2E_BASE_URL: 'https://app.example.com', CI: undefined },
        });
        expect(result).toMatchObject({ passed: true, startedApp: false, tearDownOk: true });
    });

    it('uses an explicit grep over the configured smoke grep', async () => {
        await runLiveSmoke('/repo', config, 'https://app.example.com', { grep: '@checkout' }, deps);

        expect(runShell).toHaveBeenCalledWith('bunx playwright test --grep "@checkout"', expect.anything());
    });

    it('reports failed tests from stdout and stderr', async () => {
        runShell.mockResolvedValue({
            exitCode: 1,
            stdout: '  1) e2e/home.spec.ts:3 > loads @smoke\n',
            stderr: '  2) e2e/login.spec.ts:8 > signs in @smoke\n',
        });

        const result = await runLiveSmoke('/repo', config, 'https://app.example.com', {}, deps);

        expect(result.passed).toBe(false);
        expect(result.failedTests).toEqual([
            'e2e/home.spec.ts:3 > loads @smoke',
            'e2e/login.spec.ts:8 > signs in @smoke',
        ]);
    });
});
