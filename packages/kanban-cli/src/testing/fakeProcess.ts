import type { CommandResult } from '../process/shell';

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

    const on = (prefix: string[], ...responses: Response[]) => {
        routes.push({ prefix, responses });
    };

    const run = async (argv: string[]): Promise<CommandResult> => {
        calls.push(argv);
        const route = routes.find((r) => r.prefix.every((part, i) => argv[i] === part));
        if (!route) throw new Error(`fakeProcess: no route for ${argv.join(' ')}`);

        const response = route.responses.length > 1 ? route.responses.shift() : route.responses[0];
        if (response instanceof Error) throw response;
        return { exitCode: 0, stdout: '', stderr: '', ...response };
    };

    return { on, run, calls };
}

export const json = (value: unknown): Partial<CommandResult> => ({ stdout: JSON.stringify(value) });
