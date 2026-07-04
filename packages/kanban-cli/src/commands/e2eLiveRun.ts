import { runLiveSmoke } from '../e2e/liveRunner';
import { RepoConfigError } from '../repoConfig/errors';
import { loadRepoConfig } from '../repoConfig/loader';

export async function e2eLiveRun(repoPath: string, url: string, options: { grep?: string } = {}) {
    const loaded = loadRepoConfig(repoPath);
    if (!loaded.configFound) throw new RepoConfigError(`No .kanban-cli.json found at ${repoPath}`);

    const result = await runLiveSmoke(repoPath, loaded.config, url, options);
    return { ok: true as const, result };
}
