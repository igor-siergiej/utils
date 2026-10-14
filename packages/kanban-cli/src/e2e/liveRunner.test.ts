import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runShell } from '../process/shell';
import type { RepoConfig } from '../repoConfig/types';
import { runLiveSmoke } from './liveRunner';

vi.mock('../process/shell', () => ({ runShell: vi.fn() }));

const config = { e2e: { testCommand: 'bunx playwright test', smokeGrep: '@smoke' } } as RepoConfig;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runShell).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

describe('runLiveSmoke', () => {
    it('scopes to the smoke grep and points tests at the live URL with CI stripped', async () => {
        const result = await runLiveSmoke('/repo', config, 'https://app.example.com');

        expect(runShell).toHaveBeenCalledOnce();
        expect(runShell).toHaveBeenCalledWith('bunx playwright test --grep "@smoke"', {
            cwd: '/repo',
            env: { E2E_BASE_URL: 'https://app.example.com', CI: undefined },
        });
        expect(result).toMatchObject({ passed: true, startedApp: false, tearDownOk: true });
    });

    it('uses an explicit grep over the configured smoke grep', async () => {
        await runLiveSmoke('/repo', config, 'https://app.example.com', { grep: '@checkout' });

        expect(runShell).toHaveBeenCalledWith('bunx playwright test --grep "@checkout"', expect.anything());
    });

    it('reports failed tests from stdout and stderr', async () => {
        vi.mocked(runShell).mockResolvedValue({
            exitCode: 1,
            stdout: '  1) e2e/home.spec.ts:3 > loads @smoke\n',
            stderr: '  2) e2e/login.spec.ts:8 > signs in @smoke\n',
        });

        const result = await runLiveSmoke('/repo', config, 'https://app.example.com');

        expect(result.passed).toBe(false);
        expect(result.failedTests).toEqual([
            'e2e/home.spec.ts:3 > loads @smoke',
            'e2e/login.spec.ts:8 > signs in @smoke',
        ]);
    });
});
