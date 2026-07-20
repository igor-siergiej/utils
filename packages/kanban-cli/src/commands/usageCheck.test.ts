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
        expect(result).toEqual({
            ok: true,
            result: { status: 'pause', usedPct: 92, resetsAt: '2026-07-20T18:00:00.000Z' },
        });
    });

    it('honors a custom --threshold', () => {
        const recordedAt = '2026-07-20T15:00:00.000Z';
        writeUsageState(statePath, { usedPct: 60, resetsAt: '2026-07-20T18:00:00.000Z', recordedAt });
        const result = usageCheck({ statePath, thresholdPct: 50, now: () => Date.parse(recordedAt) });
        expect(result).toEqual({
            ok: true,
            result: { status: 'pause', usedPct: 60, resetsAt: '2026-07-20T18:00:00.000Z' },
        });
    });

    it('honors a custom --max-staleness-ms, going unknown once stale', () => {
        const recordedAt = '2026-07-20T15:00:00.000Z';
        writeUsageState(statePath, { usedPct: 95, resetsAt: 'x', recordedAt });
        const result = usageCheck({ statePath, maxStalenessMs: 1000, now: () => Date.parse(recordedAt) + 1001 });
        expect(result).toEqual({ ok: true, result: { status: 'unknown' } });
    });
});
