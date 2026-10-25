import { runArgv } from '../process/shell';
import { isRecord } from '../typeGuards';

/** A task of `jott task show --json`. */
export interface JottTask {
    id: string;
    number: number;
    title: string;
    project: string | null;
    status: string;
    tags: string[];
    meta: Record<string, unknown>;
}

export interface CardPatch {
    /** jott CLI spelling: `in-progress`, `blocked`, … */
    status?: string;
    meta?: Record<string, unknown>;
    unmeta?: string[];
}

/** The jott calls the dispatcher makes; `jottBoard` is the real one, tests pass a fake. */
export interface Board {
    sync(): Promise<void>;
    show(n: number): Promise<JottTask>;
    set(n: number, patch: CardPatch): Promise<void>;
}

async function jott(args: string[]): Promise<Record<string, unknown>> {
    const result = await runArgv(['jott', ...args, '--json'], { cwd: process.cwd(), env: { JOTT_NO_BANNER: '1' } });
    const out = (result.stdout.trim() || result.stderr.trim()).split('\n').pop() ?? '';
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(out) as Record<string, unknown>;
    } catch {
        throw new Error(`jott ${args[0]} printed no JSON (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
    if (parsed.ok === false) throw new Error(`jott ${args.join(' ')}: ${String(parsed.error)}`);
    return parsed;
}

function isJottTask(v: unknown): v is JottTask {
    return (
        isRecord(v) &&
        typeof v.id === 'string' &&
        typeof v.number === 'number' &&
        typeof v.status === 'string' &&
        isRecord(v.meta)
    );
}

export const jottBoard: Board = {
    async sync() {
        await jott(['sync']);
    },
    async show(n) {
        const task = (await jott(['task', 'show', String(n)])).task;
        if (!isJottTask(task)) throw new Error(`jott task show ${n} printed no task`);
        return task;
    },
    async set(n, patch) {
        const args = ['task', 'set', String(n)];
        if (patch.status) args.push('--status', patch.status);
        for (const [k, v] of Object.entries(patch.meta ?? {})) args.push('--meta', `${k}=${JSON.stringify(v)}`);
        for (const k of patch.unmeta ?? []) args.push('--unmeta', k);
        await jott(args);
    },
};

/**
 * The local task for a card the server named. Numbers can be renumbered on a sync
 * collision, so the local `#N` must carry the server's id before anything writes to it.
 */
export async function localCard(board: Board, card: { id: string; number: number }): Promise<JottTask> {
    const task = await board.show(card.number);
    if (task.id !== card.id) throw new Error(`local #${card.number} is a different card`);
    return task;
}

/** `board.set` on a card the server named, refused when the local `#N` is another card. */
export async function setCard(board: Board, card: { id: string; number: number }, patch: CardPatch): Promise<void> {
    await localCard(board, card);
    await board.set(card.number, patch);
}
