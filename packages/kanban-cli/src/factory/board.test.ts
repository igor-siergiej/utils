import { describe, expect, it } from 'vitest';

import type { CommandResult } from '../process/shell';
import { createJottBoard } from './board';

// Envelopes exactly as `jott --json` prints them (jott/tui/src/cli.rs: `{"ok":true}` for sync and
// set, `{"ok":true,"task":…}` for show; tui/src/main.rs: `{"ok":false,"error":…}` on failure).
const TASK = {
    id: 'task-5',
    number: 5,
    title: 'card 5',
    project: 'tandra',
    status: 'todo',
    position: 1,
    tags: [],
    body: '',
    meta: { branch: 'x' },
    created_at: 1,
    updated_at: 2,
};

function board(stdout: string, exitCode = 0) {
    const calls: string[][] = [];

    const run = async (argv: string[]): Promise<CommandResult> => {
        calls.push(argv);

        return { exitCode, stdout, stderr: '' };
    };

    return { calls, board: createJottBoard(run) };
}

describe('createJottBoard', () => {
    it('syncs on a bare {"ok":true} envelope', async () => {
        const { board: b, calls } = board('{"ok":true}\n');

        await expect(b.sync()).resolves.toBeUndefined();
        expect(calls[0]).toEqual(['jott', 'sync', '--json']);
    });

    it('sets on a bare {"ok":true} envelope and passes the patch as flags', async () => {
        const { board: b, calls } = board('{"ok":true}\n');

        await b.set(5, { status: 'blocked', meta: { blocked_reason: 'why' }, unmeta: ['branch'] });

        expect(calls[0]).toEqual([
            'jott',
            'task',
            'set',
            '5',
            '--status',
            'blocked',
            '--meta',
            'blocked_reason="why"',
            '--unmeta',
            'branch',
            '--json',
        ]);
    });

    it('shows the task from an {"ok":true,"task":…} envelope', async () => {
        const { board: b } = board(JSON.stringify({ ok: true, task: TASK }));

        await expect(b.show(5)).resolves.toMatchObject({
            id: 'task-5',
            number: 5,
            status: 'todo',
            meta: { branch: 'x' },
        });
    });

    it('rejects a show envelope without a task', async () => {
        const { board: b } = board('{"ok":true}');

        await expect(b.show(5)).rejects.toThrow('jott task show 5 printed no task');
    });

    it.each([
        ['sync', (b: ReturnType<typeof createJottBoard>) => b.sync()],
        ['set', (b: ReturnType<typeof createJottBoard>) => b.set(5, { status: 'done' })],
        ['show', (b: ReturnType<typeof createJottBoard>) => b.show(5)],
    ])('throws the jott error on a failed %s', async (_name, call) => {
        const { board: b } = board('{"ok":false,"error":"no such task #5"}', 1);

        await expect(call(b)).rejects.toThrow('no such task #5');
    });

    it('reports output that is not JSON', async () => {
        const { board: b } = board('boom', 2);

        await expect(b.sync()).rejects.toThrow('jott sync printed no JSON (exit 2)');
    });
});
