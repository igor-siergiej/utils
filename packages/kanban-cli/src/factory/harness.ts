import { claudeHarness } from './claudeHarness';
import { ompHarness } from './ompHarness';

export type HarnessOutcome =
    | { kind: 'done'; sessionId: string }
    | { kind: 'rate_limited'; resetsAt: string; sessionId?: string }
    | { kind: 'failed'; exitCode: number; summary: string };

export interface HarnessRun {
    cwd: string;
    prompt: string;
    /** Session to continue, from an earlier rate-limited run of the same card. */
    resume?: string;
}

/** One headless agent run for one card. Adding a harness (pi, …) means one more of these. */
export interface Harness {
    run(opts: HarnessRun): Promise<HarnessOutcome>;
}

const HARNESSES: Record<string, Harness> = { claude: claudeHarness, omp: ompHarness };

export function harnessFor(agent: string): Harness {
    // Object.hasOwn, not a plain lookup: "toString" must not resolve to a prototype member.
    const harness = Object.hasOwn(HARNESSES, agent) ? HARNESSES[agent] : undefined;
    if (!harness) throw new Error(`Unknown agent '${agent}'`);
    return harness;
}
