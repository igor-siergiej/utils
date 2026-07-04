import { runLocalE2e } from '../e2e/localRunner';
import { RepoConfigError } from '../repoConfig/errors';
import { loadRepoConfig } from '../repoConfig/loader';

export async function e2eLocalRun(repoPath: string, options: { grep?: string } = {}) {
    const loaded = loadRepoConfig(repoPath);
    if (!loaded.configFound) throw new RepoConfigError(`No .kanban-cli.json found at ${repoPath}`);

    const result = await runLocalE2e(repoPath, loaded.config, options);
    return { ok: true as const, result };
}
