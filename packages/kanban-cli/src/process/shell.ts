import { type ChildProcess, spawn } from 'node:child_process';

export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

function collect(child: ChildProcess, onStdout?: (chunk: string) => void): Promise<CommandResult> {
    const { promise, resolve, reject } = Promise.withResolvers<CommandResult>();

    let stdout = '';
    let stderr = '';
    // Decoded as UTF-8 by the stream, so a character split across two chunks stays whole.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
        onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
    });

    child.once('error', reject);
    child.once('close', (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));

    return promise;
}

export interface RunOptions {
    cwd: string;
    /** Merged over the parent environment; a key set to `undefined` is removed from the child's. */
    env?: Record<string, string | undefined>;
}

function buildEnv(env: RunOptions['env']): NodeJS.ProcessEnv | undefined {
    if (!env) return undefined;

    const merged: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/** Runs an argv array directly (no shell) — the safe default for CLIs like `gh`/`git`. */
export async function runArgv(argv: string[], options: RunOptions): Promise<CommandResult> {
    const [command, ...args] = argv;
    const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildEnv(options.env),
    });
    return collect(child);
}

/** Runs a shell string via bash -lc — for the arbitrary commands a repo's own .kanban-cli.json supplies. */
export async function runShell(command: string, options: RunOptions): Promise<CommandResult> {
    return runArgv(['bash', '-lc', command], options);
}

export interface StreamingOptions extends RunOptions {
    /** Called with each complete stdout line while the command runs, then the unterminated tail on exit. */
    onLine(line: string): void;
    /** Aborting kills the command's whole process tree. */
    signal?: AbortSignal;
}

/**
 * `runArgv` that hands stdout over line by line as it arrives and can be stopped.
 * The full output is still returned, for parsers that read the whole run.
 */
export async function runArgvStreaming(
    argv: string[],
    options: StreamingOptions
): Promise<CommandResult & { killed: boolean }> {
    const [command, ...args] = argv;
    const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildEnv(options.env),
    });

    let partial = '';
    const done = collect(child, (chunk) => {
        const lines = (partial + chunk).split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) options.onLine(line);
    });

    let killing: Promise<void> | undefined;
    const kill = () => {
        if (child.pid !== undefined) killing ??= killProcessTree(child.pid);
    };
    if (options.signal?.aborted) kill();
    options.signal?.addEventListener('abort', kill, { once: true });
    try {
        const result = await done;
        if (partial) options.onLine(partial);
        await killing;
        return { ...result, killed: killing !== undefined };
    } finally {
        options.signal?.removeEventListener('abort', kill);
    }
}

export interface TrackedProcess {
    pid: number;
    /** Terminates the whole process tree; resolves once nothing under it is left alive. */
    kill: () => Promise<void>;
    exited: Promise<number>;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function signal(pid: number, sig: NodeJS.Signals): void {
    try {
        process.kill(pid, sig);
    } catch {
        // Already gone, or reparented away — nothing left to terminate.
    }
}

async function descendantPids(pid: number): Promise<number[]> {
    const { exitCode, stdout } = await runArgv(['pgrep', '-P', String(pid)], { cwd: process.cwd() });
    if (exitCode !== 0) return [];

    const children = stdout
        .split('\n')
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((child) => Number.isInteger(child));

    const nested = await Promise.all(children.map(descendantPids));
    return [...children, ...nested.flat()];
}

function delay(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
}

/**
 * Kills a background command's whole process tree, deepest descendant first.
 *
 * A dev server started as `bash -lc "<startCommand>"` sits several forks above the
 * process that actually binds the port (bash → package manager → vite/node). Killing
 * only the `bash` root leaves those descendants holding the port, so the *next* run
 * either binds a different port or fails its health check. Every descendant is
 * signalled here, then SIGKILLed if it ignores SIGTERM.
 */
export async function killProcessTree(rootPid: number, options: { graceMs?: number } = {}): Promise<void> {
    const graceMs = options.graceMs ?? 2000;
    // Deepest first, so a parent cannot spawn a replacement between the two signals.
    const pids = [...(await descendantPids(rootPid)).reverse(), rootPid];

    for (const pid of pids) signal(pid, 'SIGTERM');

    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && pids.some(isAlive)) {
        await delay(50);
    }

    for (const pid of pids.filter(isAlive)) signal(pid, 'SIGKILL');
}

/** Starts a long-lived shell command (e.g. a dev server) without waiting for it to exit. */
export function startShellInBackground(command: string, options: RunOptions): TrackedProcess {
    const child = spawn('bash', ['-lc', command], {
        cwd: options.cwd,
        stdio: 'inherit',
        env: buildEnv(options.env),
    });

    const { promise: exited, resolve } = Promise.withResolvers<number>();
    child.once('close', (code) => resolve(code ?? 0));

    return {
        pid: child.pid ?? 0,
        kill: async () => {
            if (child.pid === undefined) return;
            await killProcessTree(child.pid);
        },
        exited,
    };
}
