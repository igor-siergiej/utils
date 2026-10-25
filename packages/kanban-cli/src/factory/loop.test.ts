import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Claim, type ClaimedRun, type DispatcherApi, type EndAnswer, type EndBody } from './api';
import type { Board, CardPatch, JottTask } from './board';
import type { Harness, HarnessOutcome, HarnessRun } from './harness';
import { cycle, type LoopDeps, type RunLogEntry, STOPPED_REASON, workerPrompt } from './loop';
import type { NotifyEvent } from './notify';

const STATUS_FROM_CLI: Record<string, string> = { 'in-progress': 'in_progress' };
const CARD = { id: 'task-5', number: 5, project: 'tandra', title: 'card 5' };

const task = (status = 'todo', meta: Record<string, unknown> = {}): JottTask => ({
    ...CARD,
    status,
    tags: [],
    meta,
});

function fakeBoard(tasks: JottTask[], order: string[] = []) {
    const sets: { n: number; patch: CardPatch }[] = [];
    const board: Board = {
        sync: vi.fn(async () => {}),
        show: async (n) => {
            const t = tasks.find((x) => x.number === n);
            if (!t) throw new Error(`no #${n}`);
            return structuredClone(t);
        },
        set: async (n, patch) => {
            order.push(`set ${patch.status ?? Object.keys(patch.meta ?? {}).join(',')}`);
            sets.push({ n, patch });
            const t = tasks.find((x) => x.number === n) as JottTask;
            if (patch.status) t.status = STATUS_FROM_CLI[patch.status] ?? patch.status;
            Object.assign(t.meta, patch.meta);
            for (const k of patch.unmeta ?? []) delete t.meta[k];
        },
    };
    return { board, sets };
}

function fakeApi(claim: Claim, answer: EndAnswer = { action: 'none' }) {
    const heartbeats: (string | undefined)[] = [];
    const ends: EndBody[] = [];
    const control: { stop: boolean; heartbeatError?: Error } = { stop: false };
    const api: DispatcherApi = {
        claim: async () => claim,
        heartbeat: async (_id, activity) => {
            heartbeats.push(activity);
            if (control.heartbeatError) throw control.heartbeatError;
            return { stop: control.stop };
        },
        end: async (_id, body) => {
            ends.push(body);
            return answer;
        },
    };
    return { api, heartbeats, ends, control };
}

const claimed = (extra: Partial<ClaimedRun> = {}): Claim => ({
    run: { id: 'run-1', card: CARD, harness: 'omp', model: 'minimax-code/MiniMax-M3', ...extra },
    block: [],
});

function setup(opts: {
    claim: Claim;
    answer?: EndAnswer;
    tasks?: JottTask[];
    run?: (opts: HarnessRun, tasks: JottTask[]) => Promise<HarnessOutcome>;
    overrides?: Partial<LoopDeps>;
}) {
    const order: string[] = [];
    const tasks = opts.tasks ?? [task()];
    const { board, sets } = fakeBoard(tasks, order);
    const { api, heartbeats, ends, control } = fakeApi(opts.claim, opts.answer);
    const runs: HarnessRun[] = [];
    const harness: Harness = {
        run: vi.fn(async (run: HarnessRun): Promise<HarnessOutcome> => {
            order.push('harness');
            runs.push(run);
            return opts.run ? opts.run(run, tasks) : { kind: 'done', sessionId: 's-1' };
        }),
        activity: (line) => line || undefined,
    };
    const logs: RunLogEntry[] = [];
    const notified: NotifyEvent[] = [];
    const warnings: string[] = [];
    const deps: LoopDeps = {
        api,
        board,
        resolveRepo: () => '/repo',
        quotaFallbackMinutes: () => 45,
        harnessFor: vi.fn(() => harness),
        ensureWorktree: vi.fn(async (_r, p, n) => {
            order.push('worktree');
            return { path: `/repo/.worktrees/${p}-${n}`, branch: `factory/${p}-${n}`, created: true };
        }),
        prepareWorktree: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        now: () => Date.parse('2026-10-25T10:00:00.000Z'),
        log: (e) => logs.push(e),
        warn: (m) => warnings.push(m),
        notify: async (e) => {
            notified.push(e);
        },
        heartbeatMs: 5000,
        ...opts.overrides,
    };
    return { deps, tasks, sets, order, heartbeats, ends, control, runs, harness, logs, notified, warnings };
}

/** Writes after the run started (status in-progress, branch). */
const laterSets = (sets: { patch: CardPatch }[]) => sets.slice(2);

afterEach(() => {
    vi.useRealTimers();
});

describe('cycle', () => {
    it('does nothing on an empty claim', async () => {
        const s = setup({ claim: { run: null, block: [] } });

        expect(await cycle(s.deps)).toEqual({ blocked: [] });
        expect(s.sets).toEqual([]);
        expect(s.harness.run).not.toHaveBeenCalled();
        expect(s.ends).toEqual([]);
    });

    it('marks the card in progress, prepares the worktree, then runs the claimed harness and model', async () => {
        const s = setup({
            claim: claimed({ resume_session: 'sess-0', reply: 'use the v2 API', blocked_reason: 'which API?' }),
            run: async (_r, tasks) => {
                tasks[0].status = 'done';
                return { kind: 'done', sessionId: 's-1' };
            },
        });

        const result = await cycle(s.deps);

        expect(result).toEqual({ ran: 'tandra#5', outcome: 'done', blocked: [] });
        expect(s.order).toEqual(['set in-progress', 'worktree', 'set branch', 'harness']);
        expect(s.sets[0].patch).toEqual({ status: 'in-progress', unmeta: ['blocked_reason'] });
        expect(s.deps.harnessFor).toHaveBeenCalledWith('omp');
        expect(s.runs[0]).toMatchObject({
            cwd: '/repo/.worktrees/tandra-5',
            model: 'minimax-code/MiniMax-M3',
            resume: 'sess-0',
            quotaFallbackMinutes: 45,
        });
        expect(s.runs[0].prompt).toBe(
            workerPrompt(CARD, 'factory/tandra-5', { reply: 'use the v2 API', blocked_reason: 'which API?' })
        );
        expect(s.runs[0].prompt).toContain('It was blocked: which API?\nIgor answered your block: use the v2 API');
    });

    it('heartbeats every 5 s with the latest activity', async () => {
        vi.useFakeTimers();
        let finish: (o: HarnessOutcome) => void = () => {};
        let run: HarnessRun | undefined;
        const s = setup({
            claim: claimed(),
            run: (r, tasks) => {
                run = r;
                tasks[0].status = 'done';
                const { promise, resolve } = Promise.withResolvers<HarnessOutcome>();
                finish = resolve;
                return promise;
            },
        });

        const done = cycle(s.deps);
        await vi.advanceTimersByTimeAsync(0);
        run?.onLine('reading the card');
        await vi.advanceTimersByTimeAsync(5000);
        run?.onLine('editing loop.ts');
        run?.onLine('');
        await vi.advanceTimersByTimeAsync(5000);
        finish({ kind: 'done', sessionId: 's-1' });
        await done;
        await vi.advanceTimersByTimeAsync(20_000);

        expect(s.heartbeats).toEqual(['reading the card', 'editing loop.ts']);
    });

    it('heartbeats while the worktree is still being prepared', async () => {
        vi.useFakeTimers();
        const prep = Promise.withResolvers<void>();
        const s = setup({ claim: claimed(), overrides: { prepareWorktree: () => prep.promise } });

        const done = cycle(s.deps);
        await vi.advanceTimersByTimeAsync(5000);
        expect(s.heartbeats).toEqual([undefined]);
        expect(s.harness.run).not.toHaveBeenCalled();

        prep.resolve();
        await done;
    });

    it('stops the harness on a stop request and blocks the card, keeping the session', async () => {
        vi.useFakeTimers();
        const s = setup({
            claim: claimed(),
            run: ({ signal }) => {
                const { promise, resolve } = Promise.withResolvers<HarnessOutcome>();
                signal.addEventListener('abort', () => resolve({ kind: 'stopped', sessionId: 's-7' }));
                return promise;
            },
        });

        const done = cycle(s.deps);
        await vi.advanceTimersByTimeAsync(0);
        s.control.stop = true;
        await vi.advanceTimersByTimeAsync(5000);
        const result = await done;

        expect(s.runs[0].signal.aborted).toBe(true);
        expect(result.outcome).toBe('stopped');
        expect(s.ends).toEqual([{ outcome: 'stopped', session_id: 's-7' }]);
        expect(s.tasks[0]).toMatchObject({ status: 'blocked', meta: { blocked_reason: STOPPED_REASON } });
        expect(s.notified).toEqual([]);
    });

    it('ends a rate-limited run with an integer reset and leaves the card alone', async () => {
        const s = setup({
            claim: claimed(),
            run: async () => ({ kind: 'rate_limited', resetsAt: '2026-10-25T15:00:00.000Z', sessionId: 's-2' }),
        });

        await cycle(s.deps);

        expect(s.ends).toEqual([
            { outcome: 'rate_limited', resets_at: Date.parse('2026-10-25T15:00:00.000Z'), session_id: 's-2' },
        ]);
        expect(Number.isSafeInteger(s.ends[0].resets_at)).toBe(true);
        expect(laterSets(s.sets)).toEqual([]);
        expect(s.tasks[0].status).toBe('in_progress');
        expect(s.notified).toEqual([]);
    });

    it('leaves a failed run in progress when the server retries it', async () => {
        const s = setup({
            claim: claimed(),
            answer: { action: 'retry' },
            run: async () => ({ kind: 'failed', exitCode: 2, summary: 'boom' }),
        });

        await cycle(s.deps);

        expect(s.ends).toEqual([{ outcome: 'failed', exit_code: 2, summary: 'Worker run failed (exit 2): boom' }]);
        expect(laterSets(s.sets)).toEqual([]);
        expect(s.notified).toEqual([]);
    });

    it('blocks a failed run when the server says so', async () => {
        const s = setup({
            claim: claimed(),
            answer: { action: 'block', reason: 'Failed twice: boom' },
            run: async () => ({ kind: 'failed', exitCode: 2, summary: 'boom' }),
        });

        await cycle(s.deps);

        expect(s.tasks[0]).toMatchObject({ status: 'blocked', meta: { blocked_reason: 'Failed twice: boom' } });
        expect(s.notified).toEqual([
            { kind: 'blocked', project: 'tandra', number: 5, title: 'card 5', reason: 'Failed twice: boom' },
        ]);
    });

    it('ends done, removes the worktree and notifies when the worker finished the card', async () => {
        const home = mkdtempSync(join(tmpdir(), 'kanban-loop-home-'));
        const realHome = process.env.HOME;
        process.env.HOME = home;
        try {
            const s = setup({
                claim: claimed(),
                run: async (_r, tasks) => {
                    tasks[0].status = 'done';
                    return { kind: 'done', sessionId: 's-1' };
                },
            });

            await cycle(s.deps);

            expect(s.ends).toEqual([{ outcome: 'done', session_id: 's-1' }]);
            expect(s.deps.removeWorktree).toHaveBeenCalledWith('/repo', 'tandra', 5);
            expect(s.notified).toEqual([{ kind: 'done', project: 'tandra', number: 5, title: 'card 5' }]);
            expect(s.logs).toEqual([
                expect.objectContaining({ run: 'run-1', card: 'tandra#5', agent: 'omp', outcome: 'done' }),
            ]);
            expect(existsSync(join(home, '.local', 'state', 'kanban-cli', 'runs'))).toBe(false);
        } finally {
            process.env.HOME = realHome;
            rmSync(home, { recursive: true, force: true });
        }
    });

    it('ends blocked with the reason the worker wrote', async () => {
        const s = setup({
            claim: claimed(),
            run: async (_r, tasks) => {
                tasks[0].status = 'blocked';
                tasks[0].meta.blocked_reason = 'CI red: lint';
                return { kind: 'done', sessionId: 's-1' };
            },
        });

        await cycle(s.deps);

        expect(s.ends).toEqual([{ outcome: 'blocked', session_id: 's-1', summary: 'CI red: lint' }]);
        expect(s.notified).toEqual([
            { kind: 'blocked', project: 'tandra', number: 5, title: 'card 5', reason: 'CI red: lint' },
        ]);
        expect(s.deps.removeWorktree).not.toHaveBeenCalled();
    });

    it('fails a run that left the card in progress', async () => {
        const s = setup({ claim: claimed() });

        await cycle(s.deps);

        expect(s.ends).toEqual([
            {
                outcome: 'failed',
                session_id: 's-1',
                summary: 'The worker finished without moving the card to done or blocked.',
            },
        ]);
    });

    it('ends error when the worktree cannot be made', async () => {
        const s = setup({
            claim: claimed(),
            answer: { action: 'block', reason: 'Could not start' },
            overrides: {
                ensureWorktree: async () => {
                    throw new Error('git worktree add failed');
                },
            },
        });

        expect((await cycle(s.deps)).outcome).toBe('error');
        expect(s.ends).toEqual([{ outcome: 'error', summary: 'Could not start: git worktree add failed' }]);
        expect(s.harness.run).not.toHaveBeenCalled();
        expect(s.tasks[0].status).toBe('blocked');
    });

    it('applies the server blocks and notifies', async () => {
        const s = setup({ claim: { run: null, block: [{ card: CARD, reason: 'Failed twice' }] } });

        expect(await cycle(s.deps)).toEqual({ blocked: ['tandra#5'] });
        expect(s.tasks[0]).toMatchObject({ status: 'blocked', meta: { blocked_reason: 'Failed twice' } });
        expect(s.notified).toHaveLength(1);
    });

    it('never writes to a local card whose id differs from the claimed one', async () => {
        const other = { ...task(), id: 'someone-else' };
        const s = setup({ claim: { run: null, block: [{ card: CARD, reason: 'Failed twice' }] }, tasks: [other] });

        expect(await cycle(s.deps)).toEqual({ blocked: [] });
        expect(s.sets).toEqual([]);
        expect(s.notified).toEqual([]);
        expect(s.warnings[0]).toContain('local #5 is a different card');
    });

    it('treats a run the server already ended as lost: aborts, no end, no card writes', async () => {
        vi.useFakeTimers();
        const s = setup({
            claim: claimed(),
            run: ({ signal }) => {
                const { promise, resolve } = Promise.withResolvers<HarnessOutcome>();
                signal.addEventListener('abort', () => resolve({ kind: 'stopped', sessionId: 's-7' }));
                return promise;
            },
        });

        const done = cycle(s.deps);
        await vi.advanceTimersByTimeAsync(0);
        s.control.heartbeatError = new ApiError(400, 'POST … failed (400): run is not running');
        await vi.advanceTimersByTimeAsync(5000);

        expect((await done).outcome).toBe('lost');
        expect(s.runs[0].signal.aborted).toBe(true);
        expect(s.ends).toEqual([]);
        expect(laterSets(s.sets)).toEqual([]);
        expect(s.notified).toEqual([]);
    });
});
