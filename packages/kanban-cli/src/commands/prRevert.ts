import { revertMergeCommit } from '../github/revert';

export interface PrRevertOptions {
    commitSha: string;
    base: string;
    originalTitle: string;
    originalPrNumber?: number;
    failureSummary: string;
}

export async function prRevert(repoPath: string, options: PrRevertOptions) {
    const pr = await revertMergeCommit(repoPath, options);
    return { ok: true as const, pr };
}
