# Kanban-Worker Usage-Limit Pause/Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `kanban-worker` skill a way to proactively stop starting new backlog items before the Claude subscription's rolling 5-hour usage window is exhausted, and resume automatically once it resets — instead of running until Claude Code's usage limit hard-blocks the session mid-work.

**Architecture:** Claude Code's statusline hook already receives ground-truth `rate_limits.five_hour.{used_percentage,resets_at}` on stdin on every render while a pty is attached (confirmed by reading `~/dotfiles/claude/.claude/statusline.sh`, which already consumes `used_percentage`). A one-line addition to that script fans the same JSON out, fire-and-forget, to a new `kanban-cli record-usage` command, which persists `{usedPct, resetsAt, recordedAt}` to a small JSON state file. A new `kanban-cli usage-check` command reads that file and returns `ok` / `pause` / `unknown`. `packages/kanban-cli/skill/SKILL.md` gains a "Step 0" at the top of the per-item loop that calls `usage-check`; on `pause` the skill ends its turn and calls the harness's `ScheduleWakeup` tool for the reset time instead of starting new item work. No daemon, no supervisor process — just a state file two CLI commands read/write, and a loop-boundary check.

**Tech Stack:** Bun + TypeScript (matches the rest of `@imapps/kanban-cli`), Vitest for tests, `node:fs`/`node:os`/`node:path` only — no new dependencies.

## Global Constraints

- 4-space indentation, single quotes, semicolons always, trailing commas (es5), 120-char line width — per `packages/biome-config/configs/base.json`, which this package's `biome.json` extends.
- No new npm dependencies — `JSON.parse`/`node:fs` cover everything needed.
- Every CLI command prints one JSON object to stdout on success; a domain-level outcome (not a CLI-level failure) is always `{ ok: true, result: {...} }` with a `status` field to branch on — matches every existing command in `src/commands/`.
- Pure decision/parsing logic lives in its own module under `src/`, separate from the thin `src/commands/*.ts` wrapper that the CLI dispatches to — matches the existing `repoConfig/loader.ts` + `commands/repoCheck.ts`, `process/healthCheck.ts` + (used by) commands split.
- Time-dependent logic takes an injectable `now: () => number` (or similar), matching `process/pollForCondition.ts` / `process/healthCheck.ts`, so tests never depend on real wall-clock time.
- `record-usage` must never throw or exit non-zero — it's called fire-and-forget from the user's statusline render path, and a crash there must never break their prompt.

---

### Task 1: Usage state types + file persistence

**Files:**
- Create: `packages/kanban-cli/src/usage/types.ts`
- Create: `packages/kanban-cli/src/usage/state.ts`
- Test: `packages/kanban-cli/src/usage/state.test.ts`

**Interfaces:**
- Produces: `UsageState` (`{ usedPct: number; resetsAt: string; recordedAt: string }`), `readUsageState(path: string): UsageState | undefined`, `writeUsageState(path: string, state: UsageState): void`, `defaultUsageStatePath(): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/kanban-cli/src/usage/state.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultUsageStatePath, readUsageState, writeUsageState } from './state';

let dir: string;
let statePath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanban-cli-usage-'));
    statePath = join(dir, 'nested', 'usage-state.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('readUsageState', () => {
    it('returns undefined when the file does not exist', () => {
        expect(readUsageState(statePath)).toBeUndefined();
    });

    it('returns undefined when the file is not valid JSON', () => {
        writeUsageState(statePath, { usedPct: 10, resetsAt: 'x', recordedAt: 'y' });
        // corrupt it after a valid write to prove the read path tolerates garbage
        writeFileSync(statePath, '{ not json');
        expect(readUsageState(statePath)).toBeUndefined();
    });

    it('returns undefined when required fields are missing or the wrong type', () => {
        mkdirSync(join(dir, 'nested'), { recursive: true });
        writeFileSync(statePath, JSON.stringify({ usedPct: '90' }));
        expect(readUsageState(statePath)).toBeUndefined();
    });

    it('round-trips a state written by writeUsageState, creating parent dirs', () => {
        const state = { usedPct: 42.5, resetsAt: '2026-07-20T18:00:00.000Z', recordedAt: '2026-07-20T15:00:00.000Z' };
        writeUsageState(statePath, state);
        expect(readUsageState(statePath)).toEqual(state);
    });
});

describe('defaultUsageStatePath', () => {
    it('honors KANBAN_CLI_USAGE_STATE_PATH when set', () => {
        const original = process.env.KANBAN_CLI_USAGE_STATE_PATH;
        process.env.KANBAN_CLI_USAGE_STATE_PATH = '/tmp/custom-usage-state.json';
        expect(defaultUsageStatePath()).toBe('/tmp/custom-usage-state.json');
        if (original === undefined) delete process.env.KANBAN_CLI_USAGE_STATE_PATH;
        else process.env.KANBAN_CLI_USAGE_STATE_PATH = original;
    });

    it('falls back to ~/.claude/kanban-cli/usage-state.json', () => {
        const original = process.env.KANBAN_CLI_USAGE_STATE_PATH;
        delete process.env.KANBAN_CLI_USAGE_STATE_PATH;
        expect(defaultUsageStatePath()).toMatch(/\.claude\/kanban-cli\/usage-state\.json$/);
        if (original !== undefined) process.env.KANBAN_CLI_USAGE_STATE_PATH = original;
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/kanban-cli`): `bunx vitest run src/usage/state.test.ts`
Expected: FAIL — `Cannot find module './state'`.

- [ ] **Step 3: Write `types.ts`**

```typescript
// packages/kanban-cli/src/usage/types.ts
export interface UsageState {
    usedPct: number;
    resetsAt: string;
    recordedAt: string;
}
```

- [ ] **Step 4: Write `state.ts`**

```typescript
// packages/kanban-cli/src/usage/state.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { UsageState } from './types';

export function defaultUsageStatePath(): string {
    return process.env.KANBAN_CLI_USAGE_STATE_PATH ?? join(homedir(), '.claude', 'kanban-cli', 'usage-state.json');
}

function isUsageState(value: unknown): value is UsageState {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.usedPct === 'number' && typeof obj.resetsAt === 'string' && typeof obj.recordedAt === 'string';
}

export function readUsageState(path: string): UsageState | undefined {
    if (!existsSync(path)) return undefined;

    try {
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return isUsageState(raw) ? raw : undefined;
    } catch {
        return undefined;
    }
}

export function writeUsageState(path: string, state: UsageState): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/usage/state.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/kanban-cli/src/usage/types.ts packages/kanban-cli/src/usage/state.ts packages/kanban-cli/src/usage/state.test.ts
git commit -m "feat(kanban-cli): add usage-state file persistence"
```

---

### Task 2: Statusline payload parser

**Files:**
- Create: `packages/kanban-cli/src/usage/statuslinePayload.ts`
- Test: `packages/kanban-cli/src/usage/statuslinePayload.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `FiveHourRateLimit` (`{ usedPct: number; resetsAt: string }`), `parseFiveHourRateLimit(raw: unknown): FiveHourRateLimit | undefined`. Task 4 (`recordUsage` command) calls this directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/kanban-cli/src/usage/statuslinePayload.test.ts
import { describe, expect, it } from 'vitest';
import { parseFiveHourRateLimit } from './statuslinePayload';

describe('parseFiveHourRateLimit', () => {
    it('extracts usedPct and resetsAt (ISO string) from a well-formed statusline payload', () => {
        const payload = {
            rate_limits: {
                five_hour: { used_percentage: 62.4, resets_at: '2026-07-20T18:00:00.000Z' },
            },
        };
        expect(parseFiveHourRateLimit(payload)).toEqual({ usedPct: 62.4, resetsAt: '2026-07-20T18:00:00.000Z' });
    });

    it('normalizes a unix-seconds resets_at to an ISO string', () => {
        const payload = { rate_limits: { five_hour: { used_percentage: 10, resets_at: 1784649600 } } };
        expect(parseFiveHourRateLimit(payload)).toEqual({ usedPct: 10, resetsAt: new Date(1784649600 * 1000).toISOString() });
    });

    it('returns undefined when rate_limits is absent (unmetered plan)', () => {
        expect(parseFiveHourRateLimit({ model: { display_name: 'Sonnet' } })).toBeUndefined();
    });

    it('returns undefined when five_hour is absent', () => {
        expect(parseFiveHourRateLimit({ rate_limits: { seven_day: { used_percentage: 5, resets_at: 'x' } } })).toBeUndefined();
    });

    it('returns undefined when used_percentage is missing or not a number', () => {
        expect(parseFiveHourRateLimit({ rate_limits: { five_hour: { resets_at: 'x' } } })).toBeUndefined();
        expect(parseFiveHourRateLimit({ rate_limits: { five_hour: { used_percentage: '10', resets_at: 'x' } } })).toBeUndefined();
    });

    it('returns undefined when resets_at is missing or the wrong type', () => {
        expect(parseFiveHourRateLimit({ rate_limits: { five_hour: { used_percentage: 10 } } })).toBeUndefined();
        expect(parseFiveHourRateLimit({ rate_limits: { five_hour: { used_percentage: 10, resets_at: true } } })).toBeUndefined();
    });

    it('returns undefined for non-object input', () => {
        expect(parseFiveHourRateLimit(null)).toBeUndefined();
        expect(parseFiveHourRateLimit('not json')).toBeUndefined();
        expect(parseFiveHourRateLimit(42)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/usage/statuslinePayload.test.ts`
Expected: FAIL — `Cannot find module './statuslinePayload'`.

- [ ] **Step 3: Write `statuslinePayload.ts`**

```typescript
// packages/kanban-cli/src/usage/statuslinePayload.ts
export interface FiveHourRateLimit {
    usedPct: number;
    resetsAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Parses the same JSON payload Claude Code feeds a statusLine hook on stdin,
 * pulling out the rolling 5-hour usage window. Tolerant of the field being
 * absent entirely (e.g. unmetered plans never send `rate_limits`).
 */
export function parseFiveHourRateLimit(raw: unknown): FiveHourRateLimit | undefined {
    const fiveHour = asRecord(asRecord(asRecord(raw)?.rate_limits)?.five_hour);
    if (!fiveHour) return undefined;

    const { used_percentage, resets_at } = fiveHour;
    if (typeof used_percentage !== 'number') return undefined;

    let resetsAt: string | undefined;
    if (typeof resets_at === 'string') resetsAt = resets_at;
    else if (typeof resets_at === 'number') resetsAt = new Date(resets_at * 1000).toISOString();
    if (!resetsAt) return undefined;

    return { usedPct: used_percentage, resetsAt };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/usage/statuslinePayload.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/src/usage/statuslinePayload.ts packages/kanban-cli/src/usage/statuslinePayload.test.ts
git commit -m "feat(kanban-cli): parse five-hour rate limit from statusline payload"
```

---

### Task 3: Pure usage-evaluation decision logic

**Files:**
- Create: `packages/kanban-cli/src/usage/evaluateUsage.ts`
- Test: `packages/kanban-cli/src/usage/evaluateUsage.test.ts`

**Interfaces:**
- Consumes: `UsageState` from Task 1 (`src/usage/types.ts`).
- Produces: `UsageCheckResult` (discriminated union on `status`: `'unknown'` | `{status:'ok', usedPct}` | `{status:'pause', usedPct, resetsAt}`), `evaluateUsage(state: UsageState | undefined, options: { thresholdPct: number; maxStalenessMs: number; now: () => number }): UsageCheckResult`. Task 5 (`usageCheck` command) calls this directly.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/kanban-cli/src/usage/evaluateUsage.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateUsage } from './evaluateUsage';

const BASE_OPTIONS = { thresholdPct: 90, maxStalenessMs: 120_000 };
const RECORDED_AT = '2026-07-20T15:00:00.000Z';
const RECORDED_AT_MS = Date.parse(RECORDED_AT);

describe('evaluateUsage', () => {
    it('returns unknown when there is no state (never recorded yet)', () => {
        expect(evaluateUsage(undefined, { ...BASE_OPTIONS, now: () => RECORDED_AT_MS })).toEqual({ status: 'unknown' });
    });

    it('returns unknown when the recorded state is stale beyond maxStalenessMs', () => {
        const state = { usedPct: 95, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS + 120_001;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'unknown' });
    });

    it('treats a recordedAt in the future (clock skew) as unknown rather than trusting it', () => {
        const state = { usedPct: 95, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS - 1;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'unknown' });
    });

    it('returns ok when usage is below threshold and fresh', () => {
        const state = { usedPct: 62.4, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS + 1000;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'ok', usedPct: 62.4 });
    });

    it('returns pause with resetsAt when usage is at or above threshold', () => {
        const state = { usedPct: 90, resetsAt: '2026-07-20T18:00:00.000Z', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({
            status: 'pause',
            usedPct: 90,
            resetsAt: '2026-07-20T18:00:00.000Z',
        });
    });

    it('is exactly at the staleness boundary still counts as fresh', () => {
        const state = { usedPct: 50, resetsAt: 'x', recordedAt: RECORDED_AT };
        const now = () => RECORDED_AT_MS + 120_000;
        expect(evaluateUsage(state, { ...BASE_OPTIONS, now })).toEqual({ status: 'ok', usedPct: 50 });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/usage/evaluateUsage.test.ts`
Expected: FAIL — `Cannot find module './evaluateUsage'`.

- [ ] **Step 3: Write `evaluateUsage.ts`**

```typescript
// packages/kanban-cli/src/usage/evaluateUsage.ts
import type { UsageState } from './types';

export type UsageCheckResult =
    | { status: 'unknown' }
    | { status: 'ok'; usedPct: number }
    | { status: 'pause'; usedPct: number; resetsAt: string };

export interface EvaluateUsageOptions {
    thresholdPct: number;
    maxStalenessMs: number;
    now: () => number;
}

export function evaluateUsage(state: UsageState | undefined, options: EvaluateUsageOptions): UsageCheckResult {
    if (!state) return { status: 'unknown' };

    const ageMs = options.now() - Date.parse(state.recordedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > options.maxStalenessMs) return { status: 'unknown' };

    if (state.usedPct >= options.thresholdPct) {
        return { status: 'pause', usedPct: state.usedPct, resetsAt: state.resetsAt };
    }

    return { status: 'ok', usedPct: state.usedPct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/usage/evaluateUsage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/src/usage/evaluateUsage.ts packages/kanban-cli/src/usage/evaluateUsage.test.ts
git commit -m "feat(kanban-cli): add pure usage-window evaluation logic"
```

---

### Task 4: `record-usage` command + CLI wiring

**Files:**
- Create: `packages/kanban-cli/src/commands/recordUsage.ts`
- Test: `packages/kanban-cli/src/commands/recordUsage.test.ts`
- Modify: `packages/kanban-cli/src/cli.ts`
- Modify: `packages/kanban-cli/src/index.ts`

**Interfaces:**
- Consumes: `parseFiveHourRateLimit` (Task 2), `writeUsageState`/`defaultUsageStatePath` (Task 1).
- Produces: `recordUsage(stdinText: string, options?: { statePath?: string; now?: () => Date }): { ok: true }`. Always resolves `{ ok: true }` — never throws.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/kanban-cli/src/commands/recordUsage.test.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordUsage } from './recordUsage';

let dir: string;
let statePath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanban-cli-recordusage-'));
    statePath = join(dir, 'usage-state.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('recordUsage', () => {
    it('writes usedPct/resetsAt/recordedAt when the payload has a five_hour rate limit', () => {
        const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 71, resets_at: '2026-07-20T18:00:00.000Z' } } });
        const now = () => new Date('2026-07-20T15:00:00.000Z');

        const result = recordUsage(payload, { statePath, now });

        expect(result).toEqual({ ok: true });
        expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual({
            usedPct: 71,
            resetsAt: '2026-07-20T18:00:00.000Z',
            recordedAt: '2026-07-20T15:00:00.000Z',
        });
    });

    it('is a no-op (but still ok: true) when the payload has no five_hour rate limit', () => {
        const result = recordUsage(JSON.stringify({ model: { display_name: 'Sonnet' } }), { statePath });
        expect(result).toEqual({ ok: true });
        expect(() => readFileSync(statePath, 'utf8')).toThrow();
    });

    it('never throws on malformed JSON stdin', () => {
        expect(recordUsage('{ not valid json', { statePath })).toEqual({ ok: true });
        expect(recordUsage('', { statePath })).toEqual({ ok: true });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/commands/recordUsage.test.ts`
Expected: FAIL — `Cannot find module './recordUsage'`.

- [ ] **Step 3: Write `recordUsage.ts`**

```typescript
// packages/kanban-cli/src/commands/recordUsage.ts
import { defaultUsageStatePath, writeUsageState } from '../usage/state';
import { parseFiveHourRateLimit } from '../usage/statuslinePayload';

export interface RecordUsageOptions {
    statePath?: string;
    now?: () => Date;
}

export function recordUsage(stdinText: string, options: RecordUsageOptions = {}): { ok: true } {
    try {
        const rateLimit = parseFiveHourRateLimit(JSON.parse(stdinText));
        if (rateLimit) {
            const now = options.now ?? (() => new Date());
            writeUsageState(options.statePath ?? defaultUsageStatePath(), {
                usedPct: rateLimit.usedPct,
                resetsAt: rateLimit.resetsAt,
                recordedAt: now().toISOString(),
            });
        }
    } catch {
        // Malformed/partial stdin — this runs fire-and-forget from the user's
        // statusline render path and must never surface an error there.
    }

    return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/commands/recordUsage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `record-usage` into the CLI**

In `packages/kanban-cli/src/cli.ts`, add the import (alongside the other `commands/*` imports, alphabetically):

```typescript
import { recordUsage } from './commands/recordUsage';
```

Add a case in `main()`'s switch, before the `case undefined:` block:

```typescript
        case 'record-usage': {
            const stdinText = await Bun.stdin.text();
            printSuccess(recordUsage(stdinText));
            return;
        }
```

Update the `USAGE` string to mention it:

```typescript
const USAGE =
    'Usage: kanban-cli <command> ...\n' +
    'Commands: next, show <id>, move <id> <column>, update <id>, columns,\n' +
    '          repo-check <repoPath>, install-skill --target <dir>,\n' +
    '          e2e <local|live|bootstrap> <repoPath>, pr <create|status|merge|revert>,\n' +
    '          ci wait <repoPath> <prNumber>, deploy wait <repoPath>,\n' +
    '          record-usage (reads statusline JSON from stdin), usage-check';
```

- [ ] **Step 6: Export the new module from `index.ts`**

In `packages/kanban-cli/src/index.ts`, add (keeping the existing alphabetical grouping — insert a new `usage/` block after `repoConfig/`):

```typescript
export * from './usage/evaluateUsage';
export * from './usage/state';
export * from './usage/statuslinePayload';
export * from './usage/types';
```

- [ ] **Step 7: Run the full test suite and typecheck**

Run (from `packages/kanban-cli`): `bunx vitest run && bunx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/kanban-cli/src/commands/recordUsage.ts packages/kanban-cli/src/commands/recordUsage.test.ts packages/kanban-cli/src/cli.ts packages/kanban-cli/src/index.ts
git commit -m "feat(kanban-cli): add record-usage command"
```

---

### Task 5: `usage-check` command + CLI wiring

**Files:**
- Create: `packages/kanban-cli/src/commands/usageCheck.ts`
- Test: `packages/kanban-cli/src/commands/usageCheck.test.ts`
- Modify: `packages/kanban-cli/src/cli.ts`
- Modify: `packages/kanban-cli/src/index.ts`

**Interfaces:**
- Consumes: `readUsageState`/`defaultUsageStatePath` (Task 1), `evaluateUsage`/`UsageCheckResult` (Task 3).
- Produces: `usageCheck(options?: { thresholdPct?: number; maxStalenessMs?: number; statePath?: string; now?: () => number }): { ok: true; result: UsageCheckResult }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/kanban-cli/src/commands/usageCheck.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeUsageState } from '../usage/state';
import { usageCheck } from './usageCheck';

let dir: string;
let statePath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanban-cli-usagecheck-'));
    statePath = join(dir, 'usage-state.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('usageCheck', () => {
    it('returns unknown when no state file exists yet', () => {
        expect(usageCheck({ statePath })).toEqual({ ok: true, result: { status: 'unknown' } });
    });

    it('returns ok below the default 90% threshold', () => {
        const recordedAt = '2026-07-20T15:00:00.000Z';
        writeUsageState(statePath, { usedPct: 50, resetsAt: 'x', recordedAt });
        const result = usageCheck({ statePath, now: () => Date.parse(recordedAt) });
        expect(result).toEqual({ ok: true, result: { status: 'ok', usedPct: 50 } });
    });

    it('returns pause at or above the default 90% threshold', () => {
        const recordedAt = '2026-07-20T15:00:00.000Z';
        writeUsageState(statePath, { usedPct: 92, resetsAt: '2026-07-20T18:00:00.000Z', recordedAt });
        const result = usageCheck({ statePath, now: () => Date.parse(recordedAt) });
        expect(result).toEqual({ ok: true, result: { status: 'pause', usedPct: 92, resetsAt: '2026-07-20T18:00:00.000Z' } });
    });

    it('honors a custom --threshold', () => {
        const recordedAt = '2026-07-20T15:00:00.000Z';
        writeUsageState(statePath, { usedPct: 60, resetsAt: '2026-07-20T18:00:00.000Z', recordedAt });
        const result = usageCheck({ statePath, thresholdPct: 50, now: () => Date.parse(recordedAt) });
        expect(result).toEqual({ ok: true, result: { status: 'pause', usedPct: 60, resetsAt: '2026-07-20T18:00:00.000Z' } });
    });

    it('honors a custom --max-staleness-ms, going unknown once stale', () => {
        const recordedAt = '2026-07-20T15:00:00.000Z';
        writeUsageState(statePath, { usedPct: 95, resetsAt: 'x', recordedAt });
        const result = usageCheck({ statePath, maxStalenessMs: 1000, now: () => Date.parse(recordedAt) + 1001 });
        expect(result).toEqual({ ok: true, result: { status: 'unknown' } });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/commands/usageCheck.test.ts`
Expected: FAIL — `Cannot find module './usageCheck'`.

- [ ] **Step 3: Write `usageCheck.ts`**

```typescript
// packages/kanban-cli/src/commands/usageCheck.ts
import type { UsageCheckResult } from '../usage/evaluateUsage';
import { evaluateUsage } from '../usage/evaluateUsage';
import { defaultUsageStatePath, readUsageState } from '../usage/state';

export interface UsageCheckOptions {
    thresholdPct?: number;
    maxStalenessMs?: number;
    statePath?: string;
    now?: () => number;
}

const DEFAULT_THRESHOLD_PCT = 90;
const DEFAULT_MAX_STALENESS_MS = 120_000;

export function usageCheck(options: UsageCheckOptions = {}): { ok: true; result: UsageCheckResult } {
    const state = readUsageState(options.statePath ?? defaultUsageStatePath());
    const result = evaluateUsage(state, {
        thresholdPct: options.thresholdPct ?? DEFAULT_THRESHOLD_PCT,
        maxStalenessMs: options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS,
        now: options.now ?? Date.now,
    });

    return { ok: true, result };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/commands/usageCheck.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire `usage-check` into the CLI**

In `packages/kanban-cli/src/cli.ts`, add the import:

```typescript
import { usageCheck } from './commands/usageCheck';
```

Add a case in `main()`'s switch, next to `record-usage`:

```typescript
        case 'usage-check': {
            const { values } = parseArgs({
                args: rest,
                options: { threshold: { type: 'string' }, 'max-staleness-ms': { type: 'string' } },
            });
            printSuccess(
                usageCheck({
                    thresholdPct: values.threshold ? Number(values.threshold) : undefined,
                    maxStalenessMs: values['max-staleness-ms'] ? Number(values['max-staleness-ms']) : undefined,
                })
            );
            return;
        }
```

- [ ] **Step 6: Export the new module from `index.ts`**

In `packages/kanban-cli/src/index.ts`, the `usage/evaluateUsage` export already covers this (added in Task 4, Step 6) — no change needed here. Confirm `UsageCheckResult` is exported by checking `export * from './usage/evaluateUsage';` is present.

- [ ] **Step 7: Run the full test suite and typecheck**

Run (from `packages/kanban-cli`): `bunx vitest run && bunx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/kanban-cli/src/commands/usageCheck.ts packages/kanban-cli/src/commands/usageCheck.test.ts packages/kanban-cli/src/cli.ts
git commit -m "feat(kanban-cli): add usage-check command"
```

---

### Task 6: SKILL.md + README updates

**Files:**
- Modify: `packages/kanban-cli/skill/SKILL.md`
- Modify: `packages/kanban-cli/README.md`

**Interfaces:**
- Consumes: `kanban-cli usage-check` and `kanban-cli record-usage` CLI output shapes from Tasks 4–5 (no code interfaces — this is a docs-only task).

- [ ] **Step 1: Add Step 0 to the per-item loop in `SKILL.md`**

Open `packages/kanban-cli/skill/SKILL.md`. In the `## Per-item loop` section, change:

```markdown
Repeat from step 1 until `kanban-cli next` returns `item: null`, then stop and report
a summary of what was completed/blocked this session.
```

to:

```markdown
Repeat from step 0 until `kanban-cli next` returns `item: null`, then stop and report
a summary of what was completed/blocked this session.
```

Then insert a new numbered step **before** the existing `1. **[CLI]** \`kanban-cli next ...\`** line:

```markdown
0. **[CLI]** `kanban-cli usage-check`. This reads a state file that a companion
   line in the user's statusline hook keeps fresh with the Claude subscription's
   rolling 5-hour usage window — it has nothing to do with this board or repo.
   - `result.status: "pause"`: the window is past the safety threshold (default
     90%). **[Claude]** Do not start step 1 / new item work. Write a short
     summary of what shipped or is still `In Progress` this session (do **not**
     move or touch the in-flight item — this check only gates the boundary
     *between* items). Then call the `ScheduleWakeup` tool with `delaySeconds`
     set from `result.resetsAt` (clamp to the tool's [60, 3600] range — if
     `resetsAt` is more than an hour out, this same Step 0 check just re-fires
     and re-schedules on the next wake, cheaply, until the window has actually
     reset) and end your turn. Do not attempt to keep working past this point.
   - `result.status: "ok"` or `"unknown"`: continue to step 1 as normal.
     (`"unknown"` means no fresh usage telemetry is available — e.g. the
     statusline hasn't rendered recently, or the user hasn't wired up
     `record-usage` — proceed rather than block indefinitely on missing data.)
```

- [ ] **Step 2: Note the scope limit in `SKILL.md`**

Immediately after the `## One stuck item never stalls the board` section at the bottom of the file, add:

```markdown
## The usage-limit pause only gates between items

Step 0's `usage-check` only runs at the top-of-loop boundary. It will not
interrupt a single item's implementation, e2e run, or CI/deploy wait if that
one item's work happens to cross the threshold mid-flight — only the *next*
item is gated. This is intentional: every other checkpoint in this loop can
be mid-git-operation, mid-PR-review, or mid-poll, none of which are safe
points to abandon.
```

- [ ] **Step 3: Document the new commands in `README.md`**

In the `## CLI reference` section of `packages/kanban-cli/README.md`, add after the `deploy wait` line:

```markdown
kanban-cli record-usage                 # reads statusline JSON from stdin, persists the 5hr usage window
kanban-cli usage-check [--threshold <pct>] [--max-staleness-ms <ms>]
```

- [ ] **Step 4: Add a "Pausing on the 5-hour usage limit" section to `README.md`**

Insert a new `##` section after `## Per-repo config — .kanban-cli.json` and before `## Requirements`:

```markdown
## Pausing on the 5-hour usage limit

The `kanban-worker` skill can run for hours across many board items in one
Claude Code session. To avoid running until the Claude subscription's rolling
5-hour usage window hard-blocks mid-work, wire your Claude Code `statusLine`
hook to also feed `kanban-cli record-usage`:

```sh
# inside your statusLine script, alongside its existing rendering logic
if command -v kanban-cli >/dev/null 2>&1; then
    printf '%s' "$input" | kanban-cli record-usage >/dev/null 2>&1 &
fi
```

(`$input` is the JSON the statusLine hook already receives on stdin — the
same payload `rate_limits.five_hour.used_percentage` comes from, if your
statusline already renders a usage bar.) This persists the window's
utilization and reset time to `~/.claude/kanban-cli/usage-state.json`
(override with `KANBAN_CLI_USAGE_STATE_PATH`) every time the statusline
renders — effectively continuously, for as long as a pty stays attached to
the session.

Without this wired up, `kanban-cli usage-check` always reports `unknown` and
the `kanban-worker` skill just keeps working — the pause/resume behavior is
opt-in, not required to use the rest of the CLI.
```

- [ ] **Step 5: Commit**

```bash
git add packages/kanban-cli/skill/SKILL.md packages/kanban-cli/README.md
git commit -m "docs(kanban-cli): document usage-limit pause/resume"
```

---

### Task 7: Wire the user's statusline hook

**Files:**
- Modify: `/home/igors/dotfiles/claude/.claude/statusline.sh`

**Interfaces:**
- Consumes: `kanban-cli record-usage` (Task 4) as an external process, called by PATH lookup.

**Note:** this file lives in a separate git repository (`~/dotfiles`), not `im-apps-utils`. That repo currently has unrelated uncommitted changes (`Makefile`, `claude/.claude/settings.json`) — stage **only** `claude/.claude/statusline.sh` by name, never `git add -A`/`.`, so this commit doesn't sweep up that unrelated work.

- [ ] **Step 1: Read the current file to find the insertion point**

Open `/home/igors/dotfiles/claude/.claude/statusline.sh`. The `input=$(cat)` line near the top captures the full JSON payload into `$input` before any parsing happens — that's what gets forwarded.

- [ ] **Step 2: Add the forwarding line**

Immediately after the line `input=$(cat)`, add:

```sh
input=$(cat)
if command -v kanban-cli >/dev/null 2>&1; then
    printf '%s' "$input" | kanban-cli record-usage >/dev/null 2>&1 &
fi
```

This must come before any `exit`/early-return in the script (there are none before this point today) and must background (`&`) so a slow/hung `kanban-cli` process can never delay the statusline render the user actually sees.

- [ ] **Step 3: Manually verify it doesn't break the statusline**

Run: `echo '{"model":{"display_name":"Sonnet"},"workspace":{"current_dir":"'"$PWD"'"},"rate_limits":{"five_hour":{"used_percentage":42,"resets_at":"2026-07-20T18:00:00.000Z"}}}' | bash /home/igors/dotfiles/claude/.claude/statusline.sh`
Expected: the statusline renders exactly as before (this change is additive/silent) — no visible output change, no error printed to stderr.

- [ ] **Step 4: Verify `record-usage` actually received it**

Once `kanban-cli` (from Task 4) is installed/on `PATH` (`bun add -g @imapps/kanban-cli` after this feature ships, or `bun link` locally for testing), re-run the Step 3 command and then check:
Run: `cat ~/.claude/kanban-cli/usage-state.json`
Expected: `{"usedPct":42,"resetsAt":"2026-07-20T18:00:00.000Z","recordedAt":"<something recent>"}`

- [ ] **Step 5: Commit (in the `~/dotfiles` repo, not `im-apps-utils`)**

```bash
cd /home/igors/dotfiles
git add claude/.claude/statusline.sh
git commit -m "feat(statusline): forward rate-limit data to kanban-cli record-usage"
```

---

## Post-plan verification

After Task 5, run the full package check once from `packages/kanban-cli`:

```bash
bunx vitest run --coverage
bunx tsc --noEmit
bunx biome check .
```

All three must pass clean before Task 6/7 (docs + the separate dotfiles repo change).
