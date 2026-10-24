import { describe, expect, it, vi } from 'vitest';
import type { Board, CardPatch } from './board';
import type { Harness, HarnessOutcome } from './harness';
import { IDLE_SLEEP_MS, type LoopDeps, type RunLogEntry, tick, workerPrompt } from './loop';
import type { NotifyEvent } from './notify';
import type { JottTask } from './queue';

const NOW = Date.parse('2026-10-24T20:00:00.000Z');
const STATUS_FROM_CLI: Record<string, string> = { 'in-progress': 'in_progress' };

function fakeBoard(tasks: JottTask[], notes: Record<string, string> = { 'factory/settings': 'auto: on' }) {
    const sets: { n: number; patch: CardPatch }[] = [];
    const board: Board = {
        sync: vi.fn(async () => {}),
        list: async () => tasks.filter((t) => t.status !== 'done').map((t) => structuredClone(t)),
        show: async (n) => ({ ...structuredClone(tasks.find((t) => t.number === n) as JottTask), body: '' }),
        set: async (n, patch) => {
            sets.push({ n, patch });
            const t = tasks.find((x) => x.number === n) as JottTask;
            if (patch.status) t.status = STATUS_FROM_CLI[patch.status] ?? patch.status;
            Object.assign(t.meta, patch.meta);
            for (const k of patch.unmeta ?? []) delete t.meta[k];
        },
        readNote: async (path) => notes[path],
        writeNote: async (path, body) => {
            notes[path] = body;
        },
    };
    return { board, sets, notes };
}

const card = (number: number, status: string, meta: Record<string, unknown> = {}): JottTask => ({
    number,
    title: `card ${number}`,
    project: 'tandra',
    status,
    tags: [],
    meta,
    position: number,
});

function deps(board: Board, run: (n: number) => HarnessOutcome, onRun?: (n: number) => void) {
    const logs: RunLogEntry[] = [];
    const notified: NotifyEvent[] = [];
    const prompts: string[] = [];
    const harness: Harness = {
        run: vi.fn(async ({ prompt }) => {
            prompts.push(prompt);
            const n = Number(prompt.match(/#(\d+)/)?.[1]);
            onRun?.(n);
            return run(n);
        }),
    };
    const d: LoopDeps = {
        board,
        resolveRepo: () => '/repo',
        defaultAgent: () => undefined,
        harnessFor: () => harness,
        ensureWorktree: vi.fn(async (_r, p, n) => ({
            path: `/repo/.worktrees/${p}-${n}`,
            branch: `factory/${p}-${n}`,
            created: true,
        })),
        prepareWorktree: vi.fn(async () => {}),
        removeWorktree: vi.fn(async () => {}),
        now: () => NOW,
        log: (e) => logs.push(e),
        notify: async (e) => {
            notified.push(e);
        },
    };
    return { d, logs, prompts, harness, notified };
}

describe('tick', () => {
    it('writes idle and sleeps when nothing is ready', async () => {
        const { board, notes } = fakeBoard([card(1, 'backlog')]);
        const { d } = deps(board, () => ({ kind: 'done', sessionId: 's' }));

        expect(await tick(d, { recovered: true })).toEqual({ sleepMs: IDLE_SLEEP_MS });
        expect(notes['factory/status']).toMatch(/^state: idle\n/);
    });

    it('notes unreadable settings and still runs go cards', async () => {
        const tasks = [card(1, 'todo'), card(2, 'todo', { go: true })];
        const { board, notes } = fakeBoard(tasks, {});
        const { d } = deps(
            board,
            () => ({ kind: 'done', sessionId: 's' }),
            (n) => {
                tasks[n - 1].status = 'done';
            }
        );

        expect((await tick(d, { recovered: true })).ran).toBe('tandra#2');
        await tick(d, { recovered: true });
        expect(notes['factory/status']).toContain('factory/settings unreadable');
    });

    it('runs a card in its worktree, marks it running, and removes the worktree when done', async () => {
        const tasks = [card(5, 'todo', { go: true })];
        const { board, notes } = fakeBoard(tasks);
        let during: JottTask | undefined;
        const { d, logs, prompts, notified } = deps(
            board,
            () => ({ kind: 'done', sessionId: 's' }),
            (n) => {
                during = structuredClone(tasks[0]);
                expect(notes['factory/status']).toContain('state: running tandra#5');
                tasks[0].status = 'done';
                expect(n).toBe(5);
            }
        );

        expect(await tick(d, { recovered: true })).toEqual({ ran: 'tandra#5', sleepMs: 0 });
        expect(during?.status).toBe('in_progress');
        expect(during?.meta).toMatchObject({ factory_run: true, step: 'starting', branch: 'factory/tandra-5' });
        expect(during?.meta.go).toBeUndefined();
        expect(prompts[0]).toContain('single-card mode for tandra #5');
        expect(d.removeWorktree).toHaveBeenCalledWith('/repo', 'tandra', 5);
        expect(tasks[0].meta.factory_run).toBeUndefined();
        expect(logs[0]).toMatchObject({ card: 'tandra#5', agent: 'claude', outcome: 'done' });
        expect(notified).toEqual([{ kind: 'done', project: 'tandra', number: 5, title: 'card 5', reason: undefined }]);
    });

    it('notifies once with the reason when the worker blocks the card', async () => {
        const tasks = [card(5, 'todo', { go: true })];
        const { board } = fakeBoard(tasks);
        const { d, notified } = deps(
            board,
            () => ({ kind: 'done', sessionId: 's' }),
            () => {
                tasks[0].status = 'blocked';
                tasks[0].meta.blocked_reason = 'Need the API key';
            }
        );

        await tick(d, { recovered: true });

        expect(notified).toEqual([
            { kind: 'blocked', project: 'tandra', number: 5, title: 'card 5', reason: 'Need the API key' },
        ]);
        expect(d.removeWorktree).not.toHaveBeenCalled();
    });

    it('pauses a rate-limited card, keeps it in progress, and sleeps until the reset', async () => {
        const tasks = [card(5, 'todo', { go: true })];
        const { board, notes } = fakeBoard(tasks);
        const resetsAt = '2026-10-24T21:30:00.000Z';
        const { d, notified } = deps(board, () => ({ kind: 'rate_limited', resetsAt, sessionId: 's1' }));

        await tick(d, { recovered: true });
        const next = await tick(d, { recovered: true });

        expect(tasks[0].status).toBe('in_progress');
        expect(tasks[0].meta).toMatchObject({ paused_until: resetsAt, session_id: 's1' });
        expect(d.removeWorktree).not.toHaveBeenCalled();
        expect(notes['factory/status']).toContain(`paused_until: ${resetsAt}`);
        expect(next.sleepMs).toBe(Date.parse(resetsAt) - NOW + 30_000);
        expect(notified).toEqual([]);
    });

    it('resumes a paused card after its reset with the saved session', async () => {
        const tasks = [
            card(5, 'in_progress', { paused_until: '2026-10-24T19:00:00.000Z', session_id: 's1', factory_run: true }),
        ];
        const { board } = fakeBoard(tasks);
        const { d, harness } = deps(
            board,
            () => ({ kind: 'done', sessionId: 's1' }),
            () => {
                tasks[0].status = 'done';
            }
        );

        await tick(d, { recovered: false });

        expect(harness.run).toHaveBeenCalledWith(
            expect.objectContaining({ resume: 's1', cwd: '/repo/.worktrees/tandra-5' })
        );
    });

    it('retries a failed run once, then blocks with the failure summary', async () => {
        const tasks = [card(5, 'todo', { go: true })];
        const { board } = fakeBoard(tasks);
        const { d, logs, notified } = deps(board, () => ({ kind: 'failed', exitCode: 1, summary: 'boom' }));

        await tick(d, { recovered: true });
        expect(tasks[0]).toMatchObject({ status: 'in_progress', meta: { retries: { dispatch: 1 } } });
        expect(notified).toEqual([]);
        await tick(d, { recovered: true });

        expect(tasks[0].status).toBe('blocked');
        expect(tasks[0].meta.blocked_reason).toBe('Worker run failed (exit 1): boom');
        expect(logs.map((l) => l.outcome)).toEqual(['failed', 'blocked']);
        expect(notified).toMatchObject([{ kind: 'blocked', reason: 'Worker run failed (exit 1): boom' }]);
    });

    it('treats a worker that leaves the card in progress as a failed attempt', async () => {
        const tasks = [card(5, 'todo', { go: true })];
        const { board } = fakeBoard(tasks);
        const { d } = deps(board, () => ({ kind: 'done', sessionId: 's' }));

        await tick(d, { recovered: true });

        expect(tasks[0].meta.retries).toEqual({ dispatch: 1 });
    });

    it('passes a reply into the prompt and clears it with the old reason', async () => {
        const tasks = [card(5, 'todo', { go: true, reply: 'use aisle order', blocked_reason: 'which order?' })];
        const { board } = fakeBoard(tasks);
        const { d, prompts } = deps(
            board,
            () => ({ kind: 'done', sessionId: 's' }),
            () => {
                tasks[0].status = 'done';
            }
        );

        await tick(d, { recovered: true });

        expect(prompts[0]).toContain('It was blocked: which order?');
        expect(prompts[0]).toContain('Igor answered your block: use aisle order');
        expect(tasks[0].meta.reply).toBeUndefined();
        expect(tasks[0].meta.blocked_reason).toBeUndefined();
    });

    it('counts a card left running by a dead dispatcher as a failed attempt on startup', async () => {
        const tasks = [card(5, 'in_progress', { factory_run: true }), card(6, 'in_progress', { step: 'manual' })];
        const { board } = fakeBoard(tasks, { 'factory/settings': 'auto: off' });
        const { d } = deps(
            board,
            () => ({ kind: 'done', sessionId: 's' }),
            (n) => {
                tasks[n - 5].status = 'done';
            }
        );

        const result = await tick(d, { recovered: false });

        expect(result.ran).toBe('tandra#5');
        expect(tasks[0].meta.retries).toEqual({ dispatch: 1 });
        expect(tasks[1].meta.retries).toBeUndefined();
    });

    it('skips the tick when sync fails', async () => {
        const { board } = fakeBoard([card(5, 'todo', { go: true })]);
        board.sync = async () => {
            throw new Error('offline');
        };
        const { d, harness } = deps(board, () => ({ kind: 'done', sessionId: 's' }));

        expect(await tick(d, { recovered: true })).toEqual({ sleepMs: IDLE_SLEEP_MS });
        expect(harness.run).not.toHaveBeenCalled();
    });

    it('blocks a card whose project has no checkout', async () => {
        const tasks = [card(5, 'todo', { go: true })];
        const { board } = fakeBoard(tasks);
        const { d } = deps(board, () => ({ kind: 'done', sessionId: 's' }));
        d.resolveRepo = () => {
            throw new Error("No repo with repoName 'tandra'");
        };

        await tick(d, { recovered: true });

        expect(tasks[0].status).toBe('blocked');
        expect(tasks[0].meta.blocked_reason).toContain("No repo with repoName 'tandra'");
    });
});

describe('workerPrompt', () => {
    it('names the card and the worktree branch', () => {
        expect(workerPrompt(card(9, 'todo'), 'factory/tandra-9')).toBe(
            'Use the kanban-worker skill in single-card mode for tandra #9.\n' +
                'Work in the current directory (a git worktree on branch factory/tandra-9); do not touch any other checkout.'
        );
    });
});
