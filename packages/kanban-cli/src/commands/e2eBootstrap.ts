import { scaffoldPlaywrightConfig } from '../e2e/playwrightBootstrap';

export function e2eBootstrap(repoPath: string, options: { force?: boolean } = {}) {
    const result = scaffoldPlaywrightConfig(repoPath, options);
    return { ok: true as const, filesWritten: result.filesWritten };
}
