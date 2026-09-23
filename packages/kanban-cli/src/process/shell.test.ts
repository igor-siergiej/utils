import { describe, expect, it } from 'vitest';
import { runShell, startShellInBackground } from './shell';

// These exercise real OS processes: fork/exec and signal delivery are not something
// fake timers can advance, so the two helpers below poll the kernel and return as soon
// as the condition holds (never a fixed "long enough" sleep).
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const childPids = async (pid: number): Promise<number[]> => {
    const { stdout } = await runShell(`pgrep -P ${pid} || true`, { cwd: process.cwd() });
    return stdout
        .split('\n')
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((child) => Number.isInteger(child));
};

const waitForChildren = async (pid: number, timeoutMs = 10000): Promise<number[]> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const children = await childPids(pid);
        if (children.length > 0 || Date.now() > deadline) return children;
        await tick();
    }
};

describe('runShell env', () => {
    it('removes a variable the parent has set when its value is undefined', async () => {
        process.env.KANBAN_CLI_SHELL_TEST = 'inherited';

        try {
            const inherited = await runShell('echo "[${KANBAN_CLI_SHELL_TEST}]"', { cwd: process.cwd() });
            const stripped = await runShell('echo "[${KANBAN_CLI_SHELL_TEST}]"', {
                cwd: process.cwd(),
                env: { KANBAN_CLI_SHELL_TEST: undefined },
            });

            expect(inherited.stdout.trim()).toBe('[inherited]');
            expect(stripped.stdout.trim()).toBe('[]');
        } finally {
            delete process.env.KANBAN_CLI_SHELL_TEST;
        }
    });

    it('merges explicit values over the parent environment', async () => {
        const result = await runShell('echo "$KANBAN_CLI_SHELL_TEST"', {
            cwd: process.cwd(),
            env: { KANBAN_CLI_SHELL_TEST: 'override' },
        });

        expect(result.stdout.trim()).toBe('override');
    });
});

describe('startShellInBackground kill', () => {
    it('kills descendants, not just the shell it spawned', async () => {
        // Shaped like a dev server: `bash -lc` → subshell → the long-lived process that
        // actually holds the port. Killing only the top shell orphaned that leaf, which
        // left the port bound and broke the next run.
        const tracked = startShellInBackground('( sleep 120 & wait )', { cwd: process.cwd() });

        const children = await waitForChildren(tracked.pid);
        expect(children.length).toBeGreaterThan(0);
        const grandchildren = (await Promise.all(children.map((child) => waitForChildren(child, 2000)))).flat();

        await tracked.kill();

        for (const pid of [tracked.pid, ...children, ...grandchildren]) {
            expect(isAlive(pid)).toBe(false);
        }
    });
});
