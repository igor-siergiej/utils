import { getPullRequestStatus } from '../github/pullRequest';

export async function prStatus(repoPath: string, prNumber: number) {
    const pr = await getPullRequestStatus(repoPath, prNumber);
    return { ok: true as const, pr };
}
