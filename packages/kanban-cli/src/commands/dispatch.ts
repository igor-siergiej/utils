import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { jottBoard } from '../factory/board';
import { harnessFor } from '../factory/harness';
import { type LoopDeps, type LoopState, type RunLogEntry, type TickResult, tick } from '../factory/loop';
import { CONFIG_FILENAME } from '../repoConfig/types';
import { resolveRepoPath } from '../repoRegistry/resolveRepo';
import { ensureWorktree, prepareWorktree, removeWorktree } from '../worktree/worktree';

export function defaultLogPath(): string {
    return process.env.KANBAN_FACTORY_LOG ?? join(homedir(), '.local', 'state', 'kanban-cli', 'factory.log');
}

function defaultAgent(repo: string): string | undefined {
    const path = join(repo, CONFIG_FILENAME);
    if (!existsSync(path)) return undefined;
    try {
        const agent = (JSON.parse(readFileSync(path, 'utf8')) as { factory?: { defaultAgent?: unknown } }).factory
            ?.defaultAgent;
        return typeof agent === 'string' ? agent : undefined;
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
        defaultAgent,
        harnessFor,
        ensureWorktree,
        prepareWorktree: (repo, path) => prepareWorktree(repo, path),
        removeWorktree,
        now: Date.now,
        log: (entry) => appendLog(logPath, entry),
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
