import { z } from 'zod';

import { tryParseJson } from '../json';
import type { CommandResult, RunArgv } from '../process/shell';
import { runArgv } from '../process/shell';
import { GhCommandError, GhNotFoundError } from './errors';

export interface GhOptions {
    cwd: string;
    /** Spawns the process; tests pass a scripted one. */
    run?: RunArgv;
}

/** The single place that shells out to `gh` — every other GitHub wrapper goes through this. */
export async function runGh(args: string[], { cwd, run = runArgv }: GhOptions): Promise<string> {
    let result: CommandResult;

    try {
        result = await run(['gh', ...args], { cwd });
    } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') throw new GhNotFoundError();
        throw cause;
    }

    if (result.exitCode !== 0) {
        throw new GhCommandError(args, result.exitCode, result.stderr);
    }

    return result.stdout;
}

/** Runs `gh` and parses its JSON stdout with `schema`; output of another shape is an error. */
export async function runGhJson<T>(args: string[], options: GhOptions, schema: z.ZodType<T>): Promise<T> {
    const stdout = await runGh(args, options);
    const parsed = schema.safeParse(tryParseJson(stdout));

    if (!parsed.success) {
        throw new Error(`gh ${args.join(' ')} printed unexpected JSON: ${stdout.slice(0, 200)}`);
    }

    return parsed.data;
}
