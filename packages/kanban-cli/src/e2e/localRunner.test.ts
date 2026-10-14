import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pollHttpHealth } from '../process/healthCheck';
import { runShell, startShellInBackground } from '../process/shell';
import type { RepoConfig } from '../repoConfig/types';
import { runLocalE2e } from './localRunner';

vi.mock('../process/shell', () => ({ runShell: vi.fn(), startShellInBackground: vi.fn() }));
vi.mock('../process/healthCheck', () => ({ pollHttpHealth: vi.fn() }));

const config = (dev: Partial<RepoConfig['dev']> = {}) =>
    ({
        dev: {
            startCommand: 'bun run dev',
            healthCheckUrl: 'http://localhost:3000',
            healthCheckTimeoutMs: 5000,
            healthCheckIntervalMs: 100,
            ...dev,
        },
        e2e: { testCommand: 'bunx playwright test', reportPath: 'playwright-report' },
    }) as RepoConfig;

const kill = vi.fn();
const NO_CI: Record<string, string | undefined> = { CI: undefined };

beforeEach(() => {
    vi.clearAllMocks();
    kill.mockResolvedValue(undefined);
    vi.mocked(startShellInBackground).mockReturnValue({ pid: 1, kill, exited: new Promise(() => {}) });
    vi.mocked(pollHttpHealth).mockResolvedValue(true);
    vi.mocked(runShell).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

describe('runLocalE2e', () => {
    it('starts the app with CI stripped and health-checks it with the configured budget', async () => {
        await runLocalE2e('/repo', config());

        expect(startShellInBackground).toHaveBeenCalledWith('bun run dev', { cwd: '/repo', env: NO_CI });
        expect(pollHttpHealth).toHaveBeenCalledWith('http://localhost:3000', { timeoutMs: 5000, intervalMs: 100 });
    });

    it('runs the e2e command, reports a pass and kills the app tree', async () => {
        const result = await runLocalE2e('/repo', config());

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
        vi.mocked(runShell).mockResolvedValue({
            exitCode: 1,
            stdout: '  1) e2e/cart.spec.ts:12 > adds item\n',
            stderr: '',
        });

        const result = await runLocalE2e('/repo', config(), { grep: '@cart' });

        expect(runShell).toHaveBeenCalledWith('bunx playwright test --grep "@cart"', expect.anything());
        expect(result.passed).toBe(false);
        expect(result.failedTests).toEqual(['e2e/cart.spec.ts:12 > adds item']);
    });

    it('skips tests and tears down when the app never becomes healthy', async () => {
        vi.mocked(pollHttpHealth).mockResolvedValue(false);

        const result = await runLocalE2e('/repo', config());

        expect(runShell).not.toHaveBeenCalled();
        expect(kill).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ passed: false, failedTests: [], startedApp: true, tearDownOk: true });
    });

    it('uses teardownCommand instead of killing, and reports its exit status', async () => {
        vi.mocked(runShell)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: '' });

        const result = await runLocalE2e('/repo', config({ teardownCommand: 'docker compose down' }));

        expect(runShell).toHaveBeenLastCalledWith('docker compose down', { cwd: '/repo', env: NO_CI });
        expect(kill).not.toHaveBeenCalled();
        expect(result.tearDownOk).toBe(false);
    });

    it('reports tearDownOk false when killing the tree throws', async () => {
        kill.mockRejectedValue(new Error('EPERM'));

        const result = await runLocalE2e('/repo', config());

        expect(result.tearDownOk).toBe(false);
    });

    it('still tears down and rethrows when the test command cannot run', async () => {
        const cause = new Error('spawn bash ENOENT');
        vi.mocked(runShell).mockRejectedValue(cause);

        await expect(runLocalE2e('/repo', config())).rejects.toBe(cause);
        expect(kill).toHaveBeenCalledOnce();
    });
});
