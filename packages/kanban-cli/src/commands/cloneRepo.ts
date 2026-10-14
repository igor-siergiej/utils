import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readKanbanBoard } from '../kanban/io';
import { runArgv } from '../process/shell';
import { CONFIG_FILENAME } from '../repoConfig/types';
import { RepoResolutionError } from '../repoRegistry/errors';
import { repoRoots, resolveRepoPath } from '../repoRegistry/resolveRepo';

/**
 * Clones the board's project when it has no local checkout yet. Opt-in per board:
 * nothing happens unless the frontmatter carries a `repoUrl`. The clone lands at
 * `<root>/<project>` (default root: the first KANBAN_CLI_REPO_ROOTS entry), and gets
 * a minimal `.kanban-cli.json` if the repo does not ship one, so it resolves at once.
 */
export async function cloneRepo(boardPath: string, options: { root?: string } = {}) {
    const board = readKanbanBoard(boardPath, { requireRepo: false });
    const project = board.project as string;

    try {
        return { ok: true as const, cloned: false, repo: resolveRepoPath(project) };
    } catch (cause) {
        if (!(cause instanceof RepoResolutionError) || /more than one/.test(cause.message)) throw cause;
    }

    if (!board.repoUrl) {
        throw new RepoResolutionError(
            `No local checkout for '${project}' and the board has no 'repoUrl' frontmatter to clone from`
        );
    }

    const target = resolve(options.root ?? repoRoots()[0], project);
    if (existsSync(target)) {
        throw new RepoResolutionError(
            `${target} already exists but is not a checkout with repoName '${project}'; fix its ${CONFIG_FILENAME} or move it aside`
        );
    }

    const result = await runArgv(['git', 'clone', board.repoUrl, target], { cwd: process.cwd() });
    if (result.exitCode !== 0) {
        throw new Error(`git clone ${board.repoUrl} failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }

    const configPath = join(target, CONFIG_FILENAME);
    let configCreated = false;
    if (existsSync(configPath)) {
        const repoName = (JSON.parse(readFileSync(configPath, 'utf8')) as { repoName?: unknown }).repoName;
        if (repoName !== project) {
            throw new RepoResolutionError(
                `Cloned ${board.repoUrl} to ${target}, but its ${CONFIG_FILENAME} has repoName '${String(repoName)}', not '${project}'`
            );
        }
    } else {
        writeFileSync(configPath, `${JSON.stringify({ repoName: project }, null, 4)}\n`);
        configCreated = true;
    }

    return { ok: true as const, cloned: true, repo: target, configCreated };
}
