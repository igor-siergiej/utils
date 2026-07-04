export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

async function collect(proc: ReturnType<typeof Bun.spawn>): Promise<CommandResult> {
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
        proc.exited,
    ]);

    return { exitCode, stdout, stderr };
}

export interface RunOptions {
    cwd: string;
    env?: Record<string, string>;
}

/** Runs an argv array directly (no shell) — the safe default for CLIs like `gh`/`git`. */
export async function runArgv(argv: string[], options: RunOptions): Promise<CommandResult> {
    const proc = Bun.spawn(argv, {
        cwd: options.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: options.env ? { ...process.env, ...options.env } : undefined,
    });
    return collect(proc);
}

/** Runs a shell string via bash -lc — for the arbitrary commands a repo's own .kanban-cli.json supplies. */
export async function runShell(command: string, options: RunOptions): Promise<CommandResult> {
    return runArgv(['bash', '-lc', command], options);
}

export interface TrackedProcess {
    kill: () => void;
    exited: Promise<number>;
}

/** Starts a long-lived shell command (e.g. a dev server) without waiting for it to exit. */
export function startShellInBackground(command: string, options: RunOptions): TrackedProcess {
    const proc = Bun.spawn(['bash', '-lc', command], {
        cwd: options.cwd,
        stdout: 'inherit',
        stderr: 'inherit',
        env: options.env ? { ...process.env, ...options.env } : undefined,
    });
    return { kill: () => proc.kill(), exited: proc.exited };
}
