import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { type ApiConfig, configFromEnv, dispatcherApi } from '../factory/api';
import { jottBoard } from '../factory/board';
import { harnessFor } from '../factory/harness';
import { type CycleResult, cycle, HEARTBEAT_MS, type LoopDeps, type RunLogEntry } from '../factory/loop';
import { notify } from '../factory/notify';
import { CONFIG_FILENAME } from '../repoConfig/types';
import { repoRoots, resolveRepoPath } from '../repoRegistry/resolveRepo';
import { isRecord } from '../typeGuards';
import { ensureWorktree, prepareWorktree, removeWorktree } from '../worktree/worktree';

const CLAIM_BACKOFF_FIRST_MS = 10_000;
const CLAIM_BACKOFF_MAX_MS = 60_000;

export function defaultLogPath(): string {
    return process.env.KANBAN_FACTORY_LOG ?? join(homedir(), '.local', 'state', 'kanban-cli', 'factory.log');
}

/**
 * `factory.rateLimitFallbackMinutes` from the repo's .kanban-cli.json. The config is
 * read raw, not validated: a repo may carry only a `repoName`, which is enough for the
 * dispatcher to work a card even though the e2e/CI gates do not apply.
 */
function quotaFallbackMinutes(repo: string): number | undefined {
    const path = join(repo, CONFIG_FILENAME);
    if (!existsSync(path)) return undefined;
    try {
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        const value = isRecord(raw) && isRecord(raw.factory) ? raw.factory.rateLimitFallbackMinutes : undefined;
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
        return undefined;
    }
}

function appendLog(path: string, entry: RunLogEntry): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function realDeps(config: ApiConfig = configFromEnv(), logPath = defaultLogPath()): LoopDeps {
    return {
        api: dispatcherApi(config),
        board: jottBoard,
        resolveRepo: (project) => resolveRepoPath(project),
        repoRoot: () => repoRoots()[0],
        quotaFallbackMinutes,
        harnessFor,
        ensureWorktree,
        prepareWorktree: (repo, path) => prepareWorktree(repo, path),
        removeWorktree,
        now: Date.now,
        log: (entry) => appendLog(logPath, entry),
        warn: (message) => process.stderr.write(`${message}\n`),
        notify: (event) => notify(event),
        heartbeatMs: HEARTBEAT_MS,
    };
}

/**
 * Asks the jott server for work and runs it, forever (or one claim with `once`).
 * The claim long-polls, so there is no sleep between claims; a failing server is
 * retried with a backoff. See the README's factory section.
 */
export async function dispatch(options: { once?: boolean; deps?: LoopDeps } = {}): Promise<CycleResult | undefined> {
    const deps = options.deps ?? realDeps();
    if (options.once) return cycle(deps);
    let backoff = CLAIM_BACKOFF_FIRST_MS;
    for (;;) {
        try {
            const result = await cycle(deps);
            backoff = CLAIM_BACKOFF_FIRST_MS;
            if (result.ran) process.stdout.write(`${JSON.stringify({ ok: true, ran: result.ran })}\n`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
            await sleep(backoff);
            backoff = Math.min(backoff * 2, CLAIM_BACKOFF_MAX_MS);
        }
    }
}
