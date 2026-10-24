import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runArgv } from '../process/shell';
import type { JottTask } from './queue';

export interface CardPatch {
    /** jott CLI spelling: `in-progress`, `blocked`, … */
    status?: string;
    meta?: Record<string, unknown>;
    unmeta?: string[];
}

/** The jott calls the dispatcher makes; `jottBoard` is the real one, tests pass a fake. */
export interface Board {
    sync(): Promise<void>;
    list(): Promise<JottTask[]>;
    show(n: number): Promise<JottTask & { body: string }>;
    set(n: number, patch: CardPatch): Promise<void>;
    readNote(path: string): Promise<string | undefined>;
    writeNote(path: string, body: string): Promise<void>;
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

export const jottBoard: Board = {
    async sync() {
        await jott(['sync']);
    },
    async list() {
        return (await jott(['task', 'list'])).tasks as JottTask[];
    },
    async show(n) {
        return (await jott(['task', 'show', String(n)])).task as JottTask & { body: string };
    },
    async set(n, patch) {
        const args = ['task', 'set', String(n)];
        if (patch.status) args.push('--status', patch.status);
        for (const [k, v] of Object.entries(patch.meta ?? {})) args.push('--meta', `${k}=${JSON.stringify(v)}`);
        for (const k of patch.unmeta ?? []) args.push('--unmeta', k);
        await jott(args);
    },
    async readNote(path) {
        try {
            return ((await jott(['show', path])).note as { body: string }).body;
        } catch {
            return undefined;
        }
    },
    async writeNote(path, body) {
        if ((await this.readNote(path)) === undefined) {
            await jott(['add', '--path', path, body]);
            return;
        }
        // jott has no body-from-stdin for notes yet: `jott edit` with an "editor" that copies the new body in.
        const dir = mkdtempSync(join(tmpdir(), 'kanban-factory-'));
        try {
            const file = join(dir, 'body.md');
            writeFileSync(file, body);
            const result = await runArgv(['jott', 'edit', path], {
                cwd: dir,
                env: { EDITOR: `cp ${file}`, JOTT_NO_BANNER: '1' },
            });
            if (result.exitCode !== 0) throw new Error(`jott edit ${path} failed: ${result.stderr.trim()}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
};
