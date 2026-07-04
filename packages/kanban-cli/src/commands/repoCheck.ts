import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRepoConfig } from '../repoConfig/loader';

export function repoCheck(repoPath: string) {
    const result = loadRepoConfig(repoPath);

    if (!result.configFound) {
        return { ok: true as const, configFound: false as const };
    }

    const playwrightConfigured = existsSync(join(repoPath, result.config.e2e.configPath));

    return { ok: true as const, configFound: true as const, playwrightConfigured, config: result.config };
}
