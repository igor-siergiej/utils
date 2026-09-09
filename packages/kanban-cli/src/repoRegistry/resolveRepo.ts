import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILENAME } from '../repoConfig/types';
import { RepoResolutionError } from './errors';

export const REPO_ROOTS_ENV = 'KANBAN_CLI_REPO_ROOTS';

export function repoRoots(env: NodeJS.ProcessEnv = process.env): string[] {
    const raw = env[REPO_ROOTS_ENV];
    if (!raw || raw.trim() === '') return [homedir()];
    return raw
        .split(':')
        .map((r) => r.trim())
        .filter(Boolean);
}

export function resolveRepoPath(project: string, roots: string[] = repoRoots()): string {
    const matches: string[] = [];

    const checkDir = (dir: string) => {
        const configPath = join(dir, CONFIG_FILENAME);
        if (!existsSync(configPath)) return;
        try {
            const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { repoName?: unknown };
            if (parsed.repoName === project) matches.push(dir);
        } catch {
            // a malformed .kanban-cli.json elsewhere must not break resolution
        }
    };

    const childDirs = (dir: string): string[] => {
        try {
            return readdirSync(dir, { withFileTypes: true })
                .filter((e) => e.isDirectory() || e.isSymbolicLink())
                .map((e) => join(dir, e.name));
        } catch {
            return [];
        }
    };

    // Scan up to two levels deep: checkouts may live at <root>/<dir> or
    // <root>/<group>/<dir>. Not recursive beyond that.
    for (const root of roots) {
        for (const child of childDirs(root)) {
            checkDir(child);
            for (const grandchild of childDirs(child)) {
                checkDir(grandchild);
            }
        }
    }

    if (matches.length === 0) {
        throw new RepoResolutionError(
            `No repo with repoName '${project}' found under ${roots.join(', ')} (scanned up to two levels deep); set ${REPO_ROOTS_ENV} to the directory that contains your checkouts`
        );
    }
    if (matches.length > 1) {
        throw new RepoResolutionError(`Found more than one repo with repoName '${project}': ${matches.join(', ')}`);
    }
    return matches[0];
}
