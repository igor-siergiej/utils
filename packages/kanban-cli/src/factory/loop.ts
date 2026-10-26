import { setTimeout as sleep } from 'node:timers/promises';
import {
    ApiError,
    type ClaimCard,
    type ClaimedRun,
    type DispatcherApi,
    type EndAnswer,
    type EndBody,
    type EndOutcome,
} from './api';
import { type Board, type JottTask, localCard, setCard } from './board';
import type { Harness, HarnessOutcome } from './harness';
import type { NotifyEvent } from './notify';

export const HEARTBEAT_MS = 5_000;
const END_RETRY_FIRST_MS = 5_000;
const END_RETRY_MAX_MS = 60_000;
export const STOPPED_REASON = 'Stopped from jott';

/** `lost`: the server ended the run under us (dead-dispatcher rule); nothing is written or sent. */
export type RunOutcome = EndOutcome | 'lost';

export interface RunLogEntry {
    /** Server run id. */
    run: string;
    card: string;
    agent: string;
    model?: string;
    start: string;
    end: string;
    outcome: RunOutcome;
    exitCode?: number;
}

export interface LoopDeps {
    api: DispatcherApi;
    board: Board;
    resolveRepo(project: string): string;
    /** The first `KANBAN_CLI_REPO_ROOTS` entry: where a project-less refine runs. */
    repoRoot(): string;
    /** `factory.rateLimitFallbackMinutes` from the repo's .kanban-cli.json, when set. */
    quotaFallbackMinutes(repo: string): number | undefined;
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
    /** Diagnostics for a human reading the service journal (stderr in production). */
    warn(message: string): void;
    notify(event: NotifyEvent): Promise<void>;
    heartbeatMs: number;
}

export interface CycleResult {
    /** `<project>#<n>` of the card that ran. */
    ran?: string;
    outcome?: RunOutcome;
    /** Cards blocked locally because the server said so. */
    blocked: string[];
}

const label = (card: ClaimCard) => `${card.project ?? ''}#${card.number}`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function workerPrompt(
    card: Pick<ClaimCard, 'project' | 'number'>,
    branch: string,
    answer: { reply?: string; blocked_reason?: string } = {}
): string {
    const lines = [
        `Use the kanban-worker skill in single-card mode for ${card.project} #${card.number}.`,
        `Work in the current directory (a git worktree on branch ${branch}); do not touch any other checkout.`,
    ];
    lines.push(...replyLines(answer));
    return lines.join('\n');
}

/**
 * The prompt for a refine run: the refining skill in factory mode, plus whatever Igor
 * answered the last block. A card without a project has to be routed first.
 */
export function refinePrompt(
    card: Pick<ClaimCard, 'project' | 'number'>,
    answer: { reply?: string; blocked_reason?: string } = {}
): string {
    const where = card.project ? `${card.project} #${card.number}` : `#${card.number} (no project yet: route it first)`;
    const lines = [`Use the refining-kanban-captures skill in factory mode for ${where}.`];
    lines.push(...replyLines(answer));
    return lines.join('\n');
}

/** The lines an answer to an earlier block adds to a prompt. */
function replyLines(answer: { reply?: string; blocked_reason?: string }): string[] {
    if (!answer.reply) return [];
    return [
        ...(answer.blocked_reason ? [`It was blocked: ${answer.blocked_reason}`] : []),
        `Igor answered your block: ${answer.reply}`,
    ];
}

/**
 * Moves a server-named card to Blocked locally and syncs. A card whose local number is
 * another card is skipped (logged): the server keeps asking until the sync lands it.
 */
async function blockCard(deps: LoopDeps, card: ClaimCard, reason: string, notify: boolean): Promise<boolean> {
    try {
        await setCard(deps.board, card, { status: 'blocked', meta: { blocked_reason: reason } });
        await deps.board.sync();
    } catch (error) {
        deps.warn(`${label(card)} not blocked locally: ${message(error)}`);
        return false;
    }
    if (notify) {
        await deps.notify({
            kind: 'blocked',
            project: card.project ?? '',
            number: card.number,
            title: card.title,
            reason,
        });
    }
    return true;
}

/** Sends `end` until the server answers; a 4xx (run already ended, bad body) is logged and dropped. */
async function endRun(deps: LoopDeps, id: string, body: EndBody): Promise<EndAnswer | undefined> {
    for (let wait = END_RETRY_FIRST_MS; ; wait = Math.min(wait * 2, END_RETRY_MAX_MS)) {
        try {
            return await deps.api.end(id, body);
        } catch (error) {
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                deps.warn(`run ${id}: end dropped: ${error.message}`);
                return undefined;
            }
            deps.warn(`run ${id}: end failed, retrying in ${wait / 1000} s: ${message(error)}`);
            await sleep(wait);
        }
    }
}

interface Live {
    controller: AbortController;
    activity?: string;
    lost: boolean;
}

/**
 * Heartbeats from the moment of the claim, so a slow worktree prep is not declared
 * dead. One request in flight at a time; `stop` or a run the server already ended
 * aborts the run.
 */
function startHeartbeat(deps: LoopDeps, id: string, live: Live): () => void {
    let inFlight = false;
    const timer = setInterval(() => {
        if (inFlight || live.controller.signal.aborted) return;
        inFlight = true;
        deps.api
            .heartbeat(id, live.activity)
            .then(
                ({ stop }) => {
                    if (stop) live.controller.abort();
                },
                (error: unknown) => {
                    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
                        live.lost = true;
                        live.controller.abort();
                        deps.warn(`run ${id} lost: ${error.message}`);
                    } else {
                        deps.warn(`run ${id}: heartbeat failed: ${message(error)}`);
                    }
                }
            )
            .finally(() => {
                inFlight = false;
            });
    }, deps.heartbeatMs);
    return () => clearInterval(timer);
}

interface Finish {
    body: EndBody;
    /** Runs once the server took the outcome. */
    after?: () => Promise<void>;
}

/** What the harness needs: where to run, what to say, and where the repo config lives. */
interface HarnessCall {
    cwd: string;
    prompt: string;
    config: string;
}

/** The harness's verdict: the run ended, the harness is done, or the server ended it. */
type Driven = { kind: 'done'; sessionId: string } | { kind: 'end'; end: Finish } | 'lost';

/**
 * Runs the harness and maps its outcome onto the run's end body. A finished harness is
 * handed back to the caller: what the card's state means is the caller's business.
 */
async function driveHarness(
    deps: LoopDeps,
    run: ClaimedRun,
    live: Live,
    harness: Harness,
    call: HarnessCall
): Promise<Driven> {
    const stopped = (sessionId?: string): Finish => ({
        body: { outcome: 'stopped', ...(sessionId ? { session_id: sessionId } : {}) },
        after: async () => {
            await blockCard(deps, run.card, STOPPED_REASON, false);
        },
    });
    // Stop (or loss) while the worktree was being prepared: the harness never starts.
    if (live.lost) return 'lost';
    if (live.controller.signal.aborted) return { kind: 'end', end: stopped() };

    let outcome: HarnessOutcome;
    try {
        outcome = await harness.run({
            cwd: call.cwd,
            prompt: call.prompt,
            resume: run.resume_session,
            model: run.model || undefined,
            quotaFallbackMinutes: deps.quotaFallbackMinutes(call.config),
            onLine: (line) => {
                live.activity = harness.activity(line) ?? live.activity;
            },
            signal: live.controller.signal,
        });
    } catch (error) {
        return { kind: 'end', end: { body: { outcome: 'error', summary: `Could not start: ${message(error)}` } } };
    }
    if (live.lost) return 'lost';

    switch (outcome.kind) {
        case 'stopped':
            return { kind: 'end', end: stopped(outcome.sessionId) };
        case 'rate_limited':
            return {
                kind: 'end',
                end: {
                    body: {
                        outcome: 'rate_limited',
                        resets_at: Date.parse(outcome.resetsAt),
                        ...(outcome.sessionId ? { session_id: outcome.sessionId } : {}),
                    },
                },
            };
        case 'failed':
            return {
                kind: 'end',
                end: {
                    body: {
                        outcome: 'failed',
                        exit_code: outcome.exitCode,
                        summary: `Worker run failed (exit ${outcome.exitCode}): ${outcome.summary}`,
                    },
                },
            };
        case 'done':
            return { kind: 'done', sessionId: outcome.sessionId };
    }
}

async function work(deps: LoopDeps, run: ClaimedRun, live: Live): Promise<Finish | 'lost'> {
    return run.kind === 'refine' ? workRefine(deps, run, live) : workBuild(deps, run, live);
}

async function workBuild(deps: LoopDeps, run: ClaimedRun, live: Live): Promise<Finish | 'lost'> {
    const { card } = run;
    const project = card.project ?? '';
    let repo: string;
    let harness: Harness;
    let worktree: { path: string; branch: string };
    try {
        await deps.board.sync();
        await setCard(deps.board, card, { status: 'in-progress', unmeta: ['blocked_reason'] });
        await deps.board.sync();
        repo = deps.resolveRepo(project);
        harness = deps.harnessFor(run.harness);
        const wt = await deps.ensureWorktree(repo, project, card.number);
        if (wt.created) await deps.prepareWorktree(repo, wt.path);
        await setCard(deps.board, card, { meta: { branch: wt.branch } });
        worktree = wt;
    } catch (error) {
        return { body: { outcome: 'error', summary: `Could not start: ${message(error)}` } };
    }

    const driven = await driveHarness(deps, run, live, harness, {
        cwd: worktree.path,
        prompt: workerPrompt(card, worktree.branch, run),
        config: repo,
    });
    if (driven === 'lost') return 'lost';
    if (driven.kind === 'end') return driven.end;

    let after: JottTask;
    try {
        await deps.board.sync();
        after = await localCard(deps.board, card);
    } catch (error) {
        return { body: { outcome: 'failed', summary: `Could not read the card after the run: ${message(error)}` } };
    }
    const event = { project, number: card.number, title: card.title };
    if (after.status === 'done') {
        return {
            body: { outcome: 'done', session_id: driven.sessionId },
            after: async () => {
                await deps.removeWorktree(repo, project, card.number).catch((error: unknown) => {
                    deps.warn(`${label(card)}: worktree not removed: ${message(error)}`);
                });
                await deps.notify({ kind: 'done', ...event });
            },
        };
    }
    if (after.status === 'blocked') {
        const reason = typeof after.meta.blocked_reason === 'string' ? after.meta.blocked_reason : undefined;
        return {
            body: { outcome: 'blocked', session_id: driven.sessionId, ...(reason ? { summary: reason } : {}) },
            after: () => deps.notify({ kind: 'blocked', ...event, reason }),
        };
    }
    return {
        body: {
            outcome: 'failed',
            session_id: driven.sessionId,
            summary: 'The worker finished without moving the card to done or blocked.',
        },
    };
}

/**
 * A refine run: the refining skill reads the repo and writes the card back. It never
 * moves the card out of its column — a refined capture stays in Backlog (or Inbox) for
 * Igor to queue — so no status is written here.
 */
async function workRefine(deps: LoopDeps, run: ClaimedRun, live: Live): Promise<Finish | 'lost'> {
    const { card } = run;
    const project = card.project ?? '';
    let repo: string | undefined;
    let cwd: string;
    let harness: Harness;
    try {
        await deps.board.sync();
        await setCard(deps.board, card, { unmeta: ['blocked_reason', 'refined_at'] });
        await deps.board.sync();
        harness = deps.harnessFor(run.harness);
        if (project) {
            repo = deps.resolveRepo(project);
            const wt = await deps.ensureWorktree(repo, project, card.number);
            if (wt.created) await deps.prepareWorktree(repo, wt.path);
            cwd = wt.path;
        } else {
            // No project yet: the skill routes the card, so it runs where the checkouts are.
            cwd = deps.repoRoot();
        }
    } catch (error) {
        return { body: { outcome: 'error', summary: `Could not start: ${message(error)}` } };
    }

    const driven = await driveHarness(deps, run, live, harness, {
        cwd,
        prompt: refinePrompt(card, run),
        config: cwd,
    });
    if (driven === 'lost') return 'lost';
    if (driven.kind === 'end') return driven.end;

    let after: JottTask;
    try {
        await deps.board.sync();
        after = await localCard(deps.board, card);
    } catch (error) {
        return { body: { outcome: 'failed', summary: `Could not read the card after the run: ${message(error)}` } };
    }
    const event = { project, number: card.number, title: card.title };
    // `refined_at` is the skill's own signal that it wrote the card.
    if (typeof after.meta.refined_at === 'string') {
        return {
            body: { outcome: 'done', session_id: driven.sessionId },
            after: async () => {
                if (repo !== undefined) {
                    await deps.removeWorktree(repo, project, card.number).catch((error: unknown) => {
                        deps.warn(`${label(card)}: worktree not removed: ${message(error)}`);
                    });
                }
                await deps.notify({ kind: 'done', ...event });
            },
        };
    }
    if (after.status === 'blocked') {
        const reason = typeof after.meta.blocked_reason === 'string' ? after.meta.blocked_reason : undefined;
        return {
            body: { outcome: 'blocked', session_id: driven.sessionId, ...(reason ? { summary: reason } : {}) },
            after: () => deps.notify({ kind: 'blocked', ...event, reason }),
        };
    }
    return {
        body: {
            outcome: 'failed',
            session_id: driven.sessionId,
            summary: 'The refine run finished without writing the card.',
        },
    };
}

async function runClaimed(deps: LoopDeps, run: ClaimedRun): Promise<{ ran: string; outcome: RunOutcome }> {
    const start = deps.now();
    const live: Live = { controller: new AbortController(), lost: false };
    const stopHeartbeat = startHeartbeat(deps, run.id, live);
    let outcome: RunOutcome = 'lost';
    let exitCode: number | undefined;
    try {
        const finish = await work(deps, run, live);
        if (finish !== 'lost') {
            outcome = finish.body.outcome;
            exitCode = finish.body.exit_code;
            // The server stops listening for heartbeats once the run ended.
            stopHeartbeat();
            const answer = await endRun(deps, run.id, finish.body);
            await finish.after?.();
            if (answer?.action === 'block') await blockCard(deps, run.card, answer.reason, true);
        }
    } finally {
        stopHeartbeat();
        deps.log({
            run: run.id,
            card: label(run.card),
            agent: run.harness,
            model: run.model || undefined,
            start: new Date(start).toISOString(),
            end: new Date(deps.now()).toISOString(),
            outcome,
            exitCode,
        });
    }
    return { ran: label(run.card), outcome };
}

/** One claim: applies the server's blocks, then works the claimed run, if any, to its end. */
export async function cycle(deps: LoopDeps): Promise<CycleResult> {
    const claim = await deps.api.claim();
    const blocked: string[] = [];
    if (claim.block.length > 0) {
        await deps.board.sync().catch((error: unknown) => deps.warn(`jott sync failed: ${message(error)}`));
        for (const { card, reason } of claim.block) {
            if (await blockCard(deps, card, reason, true)) blocked.push(label(card));
        }
    }
    if (!claim.run) return { blocked };
    return { ...(await runClaimed(deps, claim.run)), blocked };
}
