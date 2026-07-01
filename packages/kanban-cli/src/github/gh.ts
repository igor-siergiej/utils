import { runArgv } from '../process/shell';
import { GhCommandError, GhNotFoundError } from './errors';

/** The single place that shells out to `gh` — every other GitHub wrapper goes through this. */
export async function runGh(args: string[], options: { cwd: string }): Promise<string> {
    let result: Awaited<ReturnType<typeof runArgv>>;

    try {
        result = await runArgv(['gh', ...args], options);
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') throw new GhNotFoundError();
        throw cause;
    }

    if (result.exitCode !== 0) {
        throw new GhCommandError(args, result.exitCode, result.stderr);
    }

    return result.stdout;
}

export async function runGhJson<T>(args: string[], options: { cwd: string }): Promise<T> {
    const stdout = await runGh(args, options);
    return JSON.parse(stdout) as T;
}
