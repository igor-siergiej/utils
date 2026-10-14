import { type ScaffoldOptions, scaffoldRepoConfig } from '../repoConfig/scaffold';

export function initConfig(repoPath: string, options: ScaffoldOptions = {}) {
    return { ok: true as const, ...scaffoldRepoConfig(repoPath, options) };
}
