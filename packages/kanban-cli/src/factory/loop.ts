import type { Board } from './board';
import type { Harness, HarnessOutcome } from './harness';
import type { NotifyEvent } from './notify';
import { type JottTask, nextCard } from './queue';
import { type FactoryStatus, formatStatus, parseSettings, SETTINGS_NOTE, STATUS_NOTE } from './settings';

export const IDLE_SLEEP_MS = 60_000;
/** Runs per card before a crashing card is blocked: the first try plus one retry. */
export const MAX_ATTEMPTS = 2;
/** Slack after a quota reset before resuming, so the window has really rolled over. */
const RESET_SLACK_MS = 30_000;

export interface RunLogEntry {
    card: string;
    agent: string;
    start: string;
    end: string;
    outcome: HarnessOutcome['kind'] | 'blocked' | 'error';
    exitCode?: number;
}

export interface LoopDeps {
    board: Board;
    resolveRepo(project: string): string;
    /** `factory.defaultAgent` from the repo's .kanban-cli.json, when set. */
    defaultAgent(repo: string): string | undefined;
    harnessFor(agent: string): Harness;
    ensureWorktree(
        repo: string,
        project: string,
        n: number
    ): Promise<{ path: string; branch: string; created: boolean }>;
    prepareWorktree(repo: string, path: string): Promise<void>;
    removeWorktree(repo: string, project: string, n: number): Promise<void>;
    now(): number;
    log(entry: RunLogEntry): void;
    notify(event: NotifyEvent): Promise<void>;
}

export interface LoopState {
    /** Crash recovery runs once, on the first tick after the dispatcher starts. */
    recovered: boolean;
}

export interface TickResult {
    ran?: string;
    sleepMs: number;
}

const label = (t: JottTask) => `${t.project}#${t.number}`;
const iso = (ms: number) => new Date(ms).toISOString();

function attempts(t: JottTask): number {
    const retries = t.meta.retries;
    const n =
        typeof retries === 'object' && retries !== null ? (retries as Record<string, unknown>).dispatch : undefined;
    return typeof n === 'number' ? n : 0;
}

function retriesWith(t: JottTask, dispatch: number): Record<string, unknown> {
    const retries = typeof t.meta.retries === 'object' && t.meta.retries !== null ? t.meta.retries : {};
    return { ...(retries as Record<string, unknown>), dispatch };
}

export function workerPrompt(t: JottTask, branch: string): string {
    const lines = [
        `Use the kanban-worker skill in single-card mode for ${t.project} #${t.number}.`,
        `Work in the current directory (a git worktree on branch ${branch}); do not touch any other checkout.`,
    ];
    if (typeof t.meta.reply === 'string') {
        if (typeof t.meta.blocked_reason === 'string') lines.push(`It was blocked: ${t.meta.blocked_reason}`);
        lines.push(`Igor answered your block: ${t.meta.reply}`);
    }
    return lines.join('\n');
}

function notifyEnd(deps: LoopDeps, t: JottTask, kind: NotifyEvent['kind'], reason?: string): Promise<void> {
    return deps.notify({ kind, project: t.project ?? '', number: t.number, title: t.title, reason });
}

async function writeStatus(deps: LoopDeps, status: Omit<FactoryStatus, 'updated'>): Promise<void> {
    await deps.board.writeNote(STATUS_NOTE, formatStatus({ ...status, updated: iso(deps.now()) }));
}

/** Counts a failed attempt: retried on the next tick below the cap, blocked at it. */
async function failAttempt(deps: LoopDeps, t: JottTask, reason: string): Promise<'retry' | 'blocked'> {
    const n = attempts(t) + 1;
    if (n >= MAX_ATTEMPTS) {
        await deps.board.set(t.number, {
            status: 'blocked',
            meta: { blocked_reason: reason, retries: retriesWith(t, n) },
            unmeta: ['factory_run', 'paused_until', 'session_id'],
        });
        await notifyEnd(deps, t, 'blocked', reason);
        return 'blocked';
    }
    await deps.board.set(t.number, {
        meta: { retries: retriesWith(t, n), paused_until: iso(deps.now()) },
        unmeta: ['factory_run', 'session_id'],
    });
    return 'retry';
}

/** A card the dispatcher was running when it died counts as one failed attempt. */
async function recover(deps: LoopDeps, tasks: JottTask[]): Promise<void> {
    for (const t of tasks) {
        if (t.status === 'in_progress' && t.meta.factory_run === true && t.meta.paused_until === undefined) {
            await failAttempt(deps, t, 'The dispatcher stopped while this card was running.');
        }
    }
}

export async function tick(deps: LoopDeps, state: LoopState): Promise<TickResult> {
    try {
        await deps.board.sync();
    } catch {
        return { sleepMs: IDLE_SLEEP_MS };
    }
    let tasks = await deps.board.list();
    if (!state.recovered) {
        state.recovered = true;
        await recover(deps, tasks);
        tasks = await deps.board.list();
    }

    const now = deps.now();
    const pauses = tasks
        .filter((t) => t.status === 'in_progress' && typeof t.meta.paused_until === 'string')
        .map((t) => Date.parse(t.meta.paused_until as string))
        .filter((at) => at > now);
    if (pauses.length > 0) {
        const until = Math.max(...pauses);
        await writeStatus(deps, { state: 'paused', pausedUntil: iso(until) });
        return { sleepMs: until - now + RESET_SLACK_MS };
    }

    const settings = parseSettings(await deps.board.readNote(SETTINGS_NOTE));
    const card = nextCard(tasks, settings, now);
    if (!card) {
        await writeStatus(deps, {
            state: 'idle',
            note: settings.valid ? undefined : `${SETTINGS_NOTE} unreadable: auto is off`,
        });
        await deps.board.sync();
        return { sleepMs: IDLE_SLEEP_MS };
    }
    await runCard(deps, card);
    await deps.board.sync();
    return { ran: label(card), sleepMs: 0 };
}

async function runCard(deps: LoopDeps, card: JottTask): Promise<void> {
    const start = deps.now();
    const project = card.project ?? '';
    let agent = typeof card.meta.agent === 'string' ? card.meta.agent : 'claude';
    const entry = (outcome: RunLogEntry['outcome'], exitCode?: number) =>
        deps.log({ card: label(card), agent, start: iso(start), end: iso(deps.now()), outcome, exitCode });

    let repo: string;
    let worktree: { path: string; branch: string };
    let harness: Harness;
    try {
        repo = deps.resolveRepo(project);
        if (typeof card.meta.agent !== 'string') agent = deps.defaultAgent(repo) ?? 'claude';
        harness = deps.harnessFor(agent);
        const wt = await deps.ensureWorktree(repo, project, card.number);
        if (wt.created) await deps.prepareWorktree(repo, wt.path);
        worktree = wt;
    } catch (error) {
        const reason = `Could not start: ${(error as Error).message}`;
        await deps.board.set(card.number, {
            status: 'blocked',
            meta: { blocked_reason: reason },
            unmeta: ['factory_run', 'paused_until'],
        });
        await notifyEnd(deps, card, 'blocked', reason);
        entry('error');
        return;
    }

    const prompt = workerPrompt(card, worktree.branch);
    const resume = typeof card.meta.session_id === 'string' ? card.meta.session_id : undefined;
    await deps.board.set(card.number, {
        status: 'in-progress',
        meta: { factory_run: true, step: 'starting', branch: worktree.branch },
        unmeta: ['paused_until', 'go', 'reply', 'blocked_reason'],
    });
    await deps.board.sync();
    await writeStatus(deps, { state: 'running', card: label(card) });

    const outcome = await harness.run({ cwd: worktree.path, prompt, resume });
    const after = await deps.board.show(card.number);

    if (outcome.kind === 'rate_limited') {
        const meta: Record<string, unknown> = { paused_until: outcome.resetsAt };
        if (outcome.sessionId) meta.session_id = outcome.sessionId;
        await deps.board.set(card.number, { meta });
        entry('rate_limited');
        return;
    }
    if (outcome.kind === 'failed') {
        const result = await failAttempt(
            deps,
            after,
            `Worker run failed (exit ${outcome.exitCode}): ${outcome.summary}`
        );
        entry(result === 'blocked' ? 'blocked' : 'failed', outcome.exitCode);
        return;
    }
    if (after.status === 'in_progress') {
        const result = await failAttempt(
            deps,
            after,
            'The worker finished without moving the card to done or blocked.'
        );
        entry(result === 'blocked' ? 'blocked' : 'failed');
        return;
    }
    await deps.board.set(card.number, { unmeta: ['factory_run', 'session_id'] });
    if (after.status === 'done') await deps.removeWorktree(repo, project, card.number);
    const reason = typeof after.meta.blocked_reason === 'string' ? after.meta.blocked_reason : undefined;
    await notifyEnd(deps, after, after.status === 'done' ? 'done' : 'blocked', reason);
    entry(after.status === 'done' ? 'done' : 'blocked');
}
