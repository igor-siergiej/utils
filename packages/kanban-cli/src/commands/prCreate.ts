import { createPullRequest } from '../github/pullRequest';

export async function prCreate(repoPath: string, options: { title: string; body: string; base: string; head: string }) {
    const pr = await createPullRequest(repoPath, options);
    return { ok: true as const, pr };
}
