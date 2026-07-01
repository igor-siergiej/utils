import { runArgv } from '../process/shell';
import { runGh } from './gh';
import { parseCreatedPrOutput } from './pullRequest';
import type { PrInfo } from './types';

export async function revertMergeCommit(
    repoPath: string,
    options: {
        commitSha: string;
        base: string;
        originalTitle: string;
        originalPrNumber?: number;
        failureSummary: string;
    }
): Promise<PrInfo> {
    const branch = `revert/${options.commitSha.slice(0, 7)}`;

    await runArgv(['git', 'fetch', 'origin', options.base], { cwd: repoPath });
    await runArgv(['git', 'checkout', '-B', branch, `origin/${options.base}`], { cwd: repoPath });

    const parents = await runArgv(['git', 'rev-list', '--parents', '-n', '1', options.commitSha], { cwd: repoPath });
    const parentCount = parents.stdout.trim().split(/\s+/).length - 1;
    const revertArgs =
        parentCount > 1
            ? ['revert', '--no-edit', '-m', '1', options.commitSha]
            : ['revert', '--no-edit', options.commitSha];

    await runArgv(['git', ...revertArgs], { cwd: repoPath });
    await runArgv(['git', 'push', '-u', 'origin', branch], { cwd: repoPath });

    const body = [
        `Automated revert of ${options.commitSha}${options.originalPrNumber ? ` (#${options.originalPrNumber})` : ''}.`,
        '',
        'Reason: the post-deploy live smoke check failed after merging this change.',
        '',
        options.failureSummary,
    ].join('\n');

    const stdout = await runGh(
        [
            'pr',
            'create',
            '--title',
            `Revert: ${options.originalTitle}`,
            '--body',
            body,
            '--base',
            options.base,
            '--head',
            branch,
        ],
        { cwd: repoPath }
    );

    return parseCreatedPrOutput(stdout);
}
