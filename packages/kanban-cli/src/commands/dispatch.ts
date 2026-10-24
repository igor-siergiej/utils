import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { jottBoard } from '../factory/board';
import { harnessFor } from '../factory/harness';
import { type LoopDeps, type LoopState, type RunLogEntry, type TickResult, tick } from '../factory/loop';
import { notify } from '../factory/notify';
import { CONFIG_FILENAME } from '../repoConfig/types';
import { resolveRepoPath } from '../repoRegistry/resolveRepo';
import { isRecord } from '../typeGuards';
import { ensureWorktree, prepareWorktree, removeWorktree } from '../worktree/worktree';

export function defaultLogPath(): string {
    return process.env.KANBAN_FACTORY_LOG ?? join(homedir(), '.local', 'state', 'kanban-cli', 'factory.log');
}

/**
 * One setting from the repo's `factory` block. The config is read raw, not
 * validated: a repo may carry only a `repoName`, which is enough for the
 * dispatcher to work a card even though the e2e/CI gates do not apply.
 */
function factorySetting(repo: string, key: 'defaultAgent' | 'defaultModel'): string | undefined {
    const path = join(repo, CONFIG_FILENAME);
    if (!existsSync(path)) return undefined;
    try {
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!isRecord(raw)) return undefined;
        const factory = raw.factory;
        if (!isRecord(factory)) return undefined;
        const value = factory[key];
        return typeof value === 'string' ? value : undefined;
    } catch {
        return undefined;
    }
}

function appendLog(path: string, entry: RunLogEntry): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function realDeps(logPath = defaultLogPath()): LoopDeps {
    return {
        board: jottBoard,
        resolveRepo: (project) => resolveRepoPath(project),
        defaultAgent: (repo) => factorySetting(repo, 'defaultAgent'),
        defaultModel: (repo) => factorySetting(repo, 'defaultModel'),
        harnessFor,
        ensureWorktree,
        prepareWorktree: (repo, path) => prepareWorktree(repo, path),
        removeWorktree,
        now: Date.now,
        log: (entry) => appendLog(logPath, entry),
        notify: (event) => notify(event),
    };
}

/** Works jott cards forever (or one tick with `once`); see the README's factory section. */
export async function dispatch(options: { once?: boolean; deps?: LoopDeps } = {}): Promise<TickResult | undefined> {
    const deps = options.deps ?? realDeps();
    const state: LoopState = { recovered: false };
    if (options.once) return tick(deps, state);
    for (;;) {
        let result: TickResult;
        try {
            result = await tick(deps, state);
        } catch (error) {
            process.stderr.write(`${JSON.stringify({ ok: false, error: (error as Error).message })}\n`);
            result = { sleepMs: 60_000 };
        }
        if (result.ran) process.stdout.write(`${JSON.stringify({ ok: true, ran: result.ran })}\n`);
        await Bun.sleep(result.sleepMs);
    }
}
