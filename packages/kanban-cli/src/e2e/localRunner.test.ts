import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RepoConfig } from '../repoConfig/types';
import { type LocalE2eDeps, runLocalE2e } from './localRunner';

const runShell = vi.fn<LocalE2eDeps['runShell']>();
const startShellInBackground = vi.fn<LocalE2eDeps['startShellInBackground']>();
const pollHttpHealth = vi.fn<LocalE2eDeps['pollHttpHealth']>();
const deps = { runShell, startShellInBackground, pollHttpHealth } satisfies LocalE2eDeps;

const config = (dev: Partial<RepoConfig['dev']> = {}): RepoConfig => ({
    repoName: 'app',
    dev: {
        startCommand: 'bun run dev',
        healthCheckUrl: 'http://localhost:3000',
        healthCheckTimeoutMs: 5000,
        healthCheckIntervalMs: 100,
        ...dev,
    },
    e2e: {
        framework: 'playwright',
        testCommand: 'bunx playwright test',
        smokeGrep: '@smoke',
        configPath: 'playwright.config.ts',
        reportPath: 'playwright-report',
    },
    ci: { workflowNames: [], checkNamesRequired: [] },
    deploy: { workflowName: 'Deploy', timeoutMs: 1, pollIntervalMs: 1 },
    environments: { production: { baseUrl: 'https://app.example.com' } },
    targetEnvironment: 'production',
    retryPolicy: { implement: 3, e2e_local: 3, ci: 3, deploy: 2, e2e_live: 1 },
    github: { defaultBranch: 'main', mergeMethod: 'squash' },
});

const kill = vi.fn();
const NO_CI = { CI: undefined };

beforeEach(() => {
    vi.clearAllMocks();
    kill.mockResolvedValue(undefined);
    startShellInBackground.mockReturnValue({ pid: 1, kill, exited: new Promise(() => {}) });
    pollHttpHealth.mockResolvedValue(true);
    runShell.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

describe('runLocalE2e', () => {
    it('starts the app with CI stripped and health-checks it with the configured budget', async () => {
        await runLocalE2e('/repo', config(), {}, deps);

        expect(startShellInBackground).toHaveBeenCalledWith('bun run dev', { cwd: '/repo', env: NO_CI });
        expect(pollHttpHealth).toHaveBeenCalledWith('http://localhost:3000', { timeoutMs: 5000, intervalMs: 100 });
    });

    it('runs the e2e command, reports a pass and kills the app tree', async () => {
        const result = await runLocalE2e('/repo', config(), {}, deps);

        expect(runShell).toHaveBeenCalledWith('bunx playwright test', { cwd: '/repo', env: NO_CI });
        expect(kill).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            passed: true,
            failedTests: [],
            reportPath: 'playwright-report',
            startedApp: true,
            tearDownOk: true,
        });
    });

    it('appends --grep and surfaces failed test names on failure', async () => {
        runShell.mockResolvedValue({
            exitCode: 1,
            stdout: '  1) e2e/cart.spec.ts:12 > adds item\n',
            stderr: '',
        });

        const result = await runLocalE2e('/repo', config(), { grep: '@cart' }, deps);

        expect(runShell).toHaveBeenCalledWith('bunx playwright test --grep "@cart"', expect.anything());
        expect(result.passed).toBe(false);
        expect(result.failedTests).toEqual(['e2e/cart.spec.ts:12 > adds item']);
    });

    it('skips tests and tears down when the app never becomes healthy', async () => {
        pollHttpHealth.mockResolvedValue(false);

        const result = await runLocalE2e('/repo', config(), {}, deps);

        expect(runShell).not.toHaveBeenCalled();
        expect(kill).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ passed: false, failedTests: [], startedApp: true, tearDownOk: true });
    });

    it('uses teardownCommand instead of killing, and reports its exit status', async () => {
        runShell
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: '' });

        const result = await runLocalE2e('/repo', config({ teardownCommand: 'docker compose down' }), {}, deps);

        expect(runShell).toHaveBeenLastCalledWith('docker compose down', { cwd: '/repo', env: NO_CI });
        expect(kill).not.toHaveBeenCalled();
        expect(result.tearDownOk).toBe(false);
    });

    it('reports tearDownOk false when killing the tree throws', async () => {
        kill.mockRejectedValue(new Error('EPERM'));

        const result = await runLocalE2e('/repo', config(), {}, deps);

        expect(result.tearDownOk).toBe(false);
    });

    it('still tears down and rethrows when the test command cannot run', async () => {
        const cause = new Error('spawn bash ENOENT');
        runShell.mockRejectedValue(cause);

        await expect(runLocalE2e('/repo', config(), {}, deps)).rejects.toBe(cause);
        expect(kill).toHaveBeenCalledOnce();
    });
});
