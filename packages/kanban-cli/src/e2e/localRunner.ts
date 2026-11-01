import { pollHttpHealth } from '../process/healthCheck';
import type { TrackedProcess } from '../process/shell';
import { runShell, startShellInBackground } from '../process/shell';
import type { RepoConfig } from '../repoConfig/types';
import { extractFailedTests } from './parseTestOutput';
import type { E2eResult } from './types';

/**
 * A local e2e run is by definition not a CI run, but agent harnesses, task runners and
 * some terminals export `CI=true` anyway. Playwright's conventional
 * `reuseExistingServer: !process.env.CI` then refuses to reuse the dev server this
 * runner just started and health-checked, and the run dies with "port already used"
 * before a single test executes — so the flag is stripped from every child here.
 */
const LOCAL_RUN_ENV = { CI: undefined };

/** What the runner reaches outside the process through; tests pass fakes. */
export interface LocalE2eDeps {
    runShell: typeof runShell;
    startShellInBackground: typeof startShellInBackground;
    pollHttpHealth: typeof pollHttpHealth;
}

const realDeps: LocalE2eDeps = { runShell, startShellInBackground, pollHttpHealth };

async function teardown(
    deps: LocalE2eDeps,
    repoPath: string,
    config: RepoConfig,
    tracked: TrackedProcess
): Promise<boolean> {
    try {
        if (config.dev.teardownCommand) {
            const result = await deps.runShell(config.dev.teardownCommand, { cwd: repoPath, env: LOCAL_RUN_ENV });

            return result.exitCode === 0;
        }

        await tracked.kill();

        return true;
    } catch {
        return false;
    }
}

export async function runLocalE2e(
    repoPath: string,
    config: RepoConfig,
    options: { grep?: string } = {},
    deps: LocalE2eDeps = realDeps
): Promise<E2eResult> {
    const startedAt = Date.now();
    const tracked = deps.startShellInBackground(config.dev.startCommand, { cwd: repoPath, env: LOCAL_RUN_ENV });

    try {
        const healthy = await deps.pollHttpHealth(config.dev.healthCheckUrl, {
            timeoutMs: config.dev.healthCheckTimeoutMs,
            intervalMs: config.dev.healthCheckIntervalMs,
        });

        if (!healthy) {
            return {
                passed: false,
                failedTests: [],
                durationMs: Date.now() - startedAt,
                startedApp: true,
                tearDownOk: await teardown(deps, repoPath, config, tracked),
            };
        }

        const testCommand = options.grep
            ? `${config.e2e.testCommand} --grep "${options.grep}"`
            : config.e2e.testCommand;

        const result = await deps.runShell(testCommand, { cwd: repoPath, env: LOCAL_RUN_ENV });

        return {
            passed: result.exitCode === 0,
            failedTests: extractFailedTests(result.stdout + result.stderr),
            reportPath: config.e2e.reportPath,
            durationMs: Date.now() - startedAt,
            startedApp: true,
            tearDownOk: await teardown(deps, repoPath, config, tracked),
        };
    } catch (cause) {
        await teardown(deps, repoPath, config, tracked);
        throw cause;
    }
}
