import { mergePullRequest } from '../github/pullRequest';

export async function prMerge(repoPath: string, prNumber: number, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    const result = await mergePullRequest(repoPath, prNumber, method);
    return { ok: true as const, ...result };
}
