import { describe, expect, it } from 'vitest';
import type { ImportPlan } from './plan';
import { summarize, writeToJott } from './write';

const plan: ImportPlan = {
    skipped: ['index.md'],
    tasks: [
        {
            source: 'a.board.md',
            project: 'a',
            status: 'blocked',
            title: '-dash title',
            tags: ['bug', 'P1'],
            body: 'b\nc',
            meta: { slug: 'a-1', pr: 7 },
        },
        { source: 'inbox.md', project: null, status: 'inbox', title: 'loose', tags: [], body: '', meta: {} },
    ],
};

function fakeJott(existing: unknown[] = []) {
    const calls: { args: string[]; stdin?: string }[] = [];
    let next = 1;
    const run = (args: string[], stdin?: string) => {
        calls.push({ args, stdin });
        if (args[1] === 'list') return { ok: true, tasks: existing };
        if (args[1] === 'add') return { ok: true, task: { number: next++ } };
        return { ok: true };
    };
    return { calls, run };
}

describe('writeToJott', () => {
    it('adds each task in order with its body on stdin, then sets meta', () => {
        const { calls, run } = fakeJott();
        expect(writeToJott(plan, run)).toEqual({ created: 2 });
        expect(calls).toEqual([
            { args: ['task', 'list', '--all', '--json'], stdin: undefined },
            {
                args: [
                    'task',
                    'add',
                    '--status',
                    'blocked',
                    '--body',
                    '-',
                    '--project',
                    'a',
                    '--tag',
                    'bug',
                    '--tag',
                    'P1',
                    '--json',
                    '--',
                    '-dash title',
                ],
                stdin: 'b\nc',
            },
            { args: ['task', 'set', '1', '--meta', 'slug="a-1"', '--meta', 'pr=7', '--json'], stdin: undefined },
            { args: ['task', 'add', '--status', 'inbox', '--body', '-', '--json', '--', 'loose'], stdin: '' },
        ]);
    });

    it('refuses when jott already holds imported tasks', () => {
        const { calls, run } = fakeJott([{ number: 3, meta: { slug: 'x' } }]);
        expect(() => writeToJott(plan, run)).toThrow(/already has imported tasks/);
        expect(calls).toHaveLength(1);
    });
});

describe('summarize', () => {
    it('counts tasks per file and status', () => {
        expect(summarize(plan)).toEqual({
            total: 2,
            files: { 'a.board.md': { blocked: 1 }, 'inbox.md': { inbox: 1 } },
            skipped: ['index.md'],
        });
    });
});
