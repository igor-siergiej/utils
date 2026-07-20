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
        const payload = JSON.stringify({
            rate_limits: { five_hour: { used_percentage: 71, resets_at: '2026-07-20T18:00:00.000Z' } },
        });
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
