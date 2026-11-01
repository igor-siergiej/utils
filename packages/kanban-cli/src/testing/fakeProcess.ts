import type { JsonValue } from '../json';
import type { CommandResult, RunOptions } from '../process/shell';

type Response = Partial<CommandResult> | Error;

interface Route {
    prefix: string[];
    responses: Response[];
}

/**
 * Scripted stand-in for `runArgv`: each route matches an argv prefix and replays its
 * responses in order (the last one repeats). Every call is recorded for assertions.
 */
export function createFakeProcess() {
    const routes: Route[] = [];
    const calls: string[][] = [];
    /** The working directory of each call, in the same order as `calls`. */
    const cwds: string[] = [];

    const on = (prefix: string[], ...responses: Response[]) => {
        routes.push({ prefix, responses });
    };

    const run = async (argv: string[], options?: RunOptions): Promise<CommandResult> => {
        calls.push(argv);
        cwds.push(options?.cwd ?? '');
        const route = routes.find((r) => r.prefix.every((part, i) => argv[i] === part));

        if (!route) throw new Error(`fakeProcess: no route for ${argv.join(' ')}`);

        const response = route.responses.length > 1 ? route.responses.shift() : route.responses[0];

        if (response instanceof Error) throw response;

        return { exitCode: 0, stdout: '', stderr: '', ...response };
    };

    return { on, run, calls, cwds };
}

export const json = (value: JsonValue | undefined): Partial<CommandResult> => ({ stdout: JSON.stringify(value) });
