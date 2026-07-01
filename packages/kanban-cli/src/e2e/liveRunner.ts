import { runShell } from '../process/shell';
import type { RepoConfig } from '../repoConfig/types';
import { extractFailedTests } from './parseTestOutput';
import type { E2eResult } from './types';

/**
 * Never starts/tears down the app (it's already running at `baseUrl`) and always
 * scopes to the repo's smoke-test grep unless explicitly overridden — a live check
 * against production must never accidentally run the full suite.
 */
export async function runLiveSmoke(
    repoPath: string,
    config: RepoConfig,
    baseUrl: string,
    options: { grep?: string } = {}
): Promise<E2eResult> {
    const startedAt = Date.now();
    const grep = options.grep ?? config.e2e.smokeGrep;
    const testCommand = `${config.e2e.testCommand} --grep "${grep}"`;

    const result = await runShell(testCommand, { cwd: repoPath, env: { E2E_BASE_URL: baseUrl } });

    return {
        passed: result.exitCode === 0,
        failedTests: extractFailedTests(result.stdout + result.stderr),
        reportPath: config.e2e.reportPath,
        durationMs: Date.now() - startedAt,
        startedApp: false,
        tearDownOk: true,
    };
}
