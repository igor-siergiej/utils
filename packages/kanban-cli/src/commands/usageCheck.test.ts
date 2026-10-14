import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    it('returns unknown with a one-time wiring hint when no state file exists yet', () => {
        const first = usageCheck({ statePath });

        expect(first.result).toMatchObject({ status: 'unknown', reason: 'no-state' });
        expect(first.result).toHaveProperty('hint', expect.stringContaining('kanban-cli record-usage'));
        expect(existsSync(`${statePath}.hint-shown`)).toBe(true);
        expect(usageCheck({ statePath })).toEqual({ ok: true, result: { status: 'unknown', reason: 'no-state' } });
    });

    it('still hints when the marker cannot be written', () => {
        const unwritable = join(dir, 'file-not-dir');
        writeFileSync(unwritable, '');

        const result = usageCheck({ statePath: join(unwritable, 'usage-state.json') });

        expect(result.result).toHaveProperty('hint');
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
        expect(result).toEqual({ ok: true, result: { status: 'unknown', reason: 'stale' } });
    });

    it('never hints about wiring once telemetry has gone stale', () => {
        writeUsageState(statePath, { usedPct: 10, resetsAt: 'x', recordedAt: '2026-07-20T15:00:00.000Z' });

        const result = usageCheck({ statePath, now: () => Date.parse('2026-07-21T15:00:00.000Z') });

        expect(result.result).not.toHaveProperty('hint');
    });
});
