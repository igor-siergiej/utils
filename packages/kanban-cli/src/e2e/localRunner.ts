import { pollHttpHealth } from '../process/healthCheck';
import type { TrackedProcess } from '../process/shell';
import { runShell, startShellInBackground } from '../process/shell';
import type { RepoConfig } from '../repoConfig/types';
import { extractFailedTests } from './parseTestOutput';
import type { E2eResult } from './types';

async function teardown(repoPath: string, config: RepoConfig, tracked: TrackedProcess): Promise<boolean> {
    try {
        if (config.dev.teardownCommand) {
            const result = await runShell(config.dev.teardownCommand, { cwd: repoPath });
            return result.exitCode === 0;
        }
        tracked.kill();
        return true;
    } catch {
        return false;
    }
}

export async function runLocalE2e(
    repoPath: string,
    config: RepoConfig,
    options: { grep?: string } = {}
): Promise<E2eResult> {
    const startedAt = Date.now();
    const tracked = startShellInBackground(config.dev.startCommand, { cwd: repoPath });

    try {
        const healthy = await pollHttpHealth(config.dev.healthCheckUrl, {
            timeoutMs: config.dev.healthCheckTimeoutMs,
            intervalMs: config.dev.healthCheckIntervalMs,
        });

        if (!healthy) {
            return {
                passed: false,
                failedTests: [],
                durationMs: Date.now() - startedAt,
                startedApp: true,
                tearDownOk: await teardown(repoPath, config, tracked),
            };
        }

        const testCommand = options.grep
            ? `${config.e2e.testCommand} --grep "${options.grep}"`
            : config.e2e.testCommand;
        const result = await runShell(testCommand, { cwd: repoPath });

        return {
            passed: result.exitCode === 0,
            failedTests: extractFailedTests(result.stdout + result.stderr),
            reportPath: config.e2e.reportPath,
            durationMs: Date.now() - startedAt,
            startedApp: true,
            tearDownOk: await teardown(repoPath, config, tracked),
        };
    } catch (cause) {
        await teardown(repoPath, config, tracked);
        throw cause;
    }
}
