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

    for (const root of roots) {
        let entries: string[];
        try {
            entries = readdirSync(root, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name);
        } catch {
            continue;
        }

        for (const name of entries) {
            const dir = join(root, name);
            const configPath = join(dir, CONFIG_FILENAME);
            if (!existsSync(configPath)) continue;
            try {
                const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { repoName?: unknown };
                if (parsed.repoName === project) matches.push(dir);
            } catch {
                // a malformed .kanban-cli.json elsewhere must not break resolution
            }
        }
    }

    if (matches.length === 0) {
        throw new RepoResolutionError(
            `No repo with repoName '${project}' found under ${roots.join(', ')}; set ${REPO_ROOTS_ENV} to the directory that contains your checkouts`
        );
    }
    if (matches.length > 1) {
        throw new RepoResolutionError(`Found more than one repo with repoName '${project}': ${matches.join(', ')}`);
    }
    return matches[0];
}
