import { claudeHarness } from './claudeHarness';
import { ompHarness } from './ompHarness';

export type HarnessOutcome =
    | { kind: 'done'; sessionId: string }
    | { kind: 'rate_limited'; resetsAt: string; sessionId?: string }
    | { kind: 'failed'; exitCode: number; summary: string }
    /** Killed through `signal`; the session so far, so a later run can resume it. */
    | { kind: 'stopped'; sessionId?: string };

export interface HarnessRun {
    cwd: string;
    prompt: string;
    /** Session to continue, from an earlier rate-limited or stopped run of the same card. */
    resume?: string;
    /** Model to run, in the harness's own syntax (omp: `provider/model`). */
    model?: string;
    /** How long to pause a card when the provider gives no reset time. */
    quotaFallbackMinutes?: number;
    /** Each stdout line as the harness prints it. Never written to disk. */
    onLine(line: string): void;
    /** Aborting kills the harness process tree; the run then ends `stopped`. */
    signal: AbortSignal;
}

/** One headless agent run for one card. Adding a harness (pi, …) means one more of these. */
export interface Harness {
    run(opts: HarnessRun): Promise<HarnessOutcome>;
    /** The live activity one stdout line shows (latest assistant text or tool call), if any. */
    activity(line: string): string | undefined;
}

const HARNESSES: Record<string, Harness> = { claude: claudeHarness, omp: ompHarness };

export function harnessFor(agent: string): Harness {
    // Object.hasOwn, not a plain lookup: "toString" must not resolve to a prototype member.
    const harness = Object.hasOwn(HARNESSES, agent) ? HARNESSES[agent] : undefined;
    if (!harness) throw new Error(`Unknown agent '${agent}'`);
    return harness;
}
