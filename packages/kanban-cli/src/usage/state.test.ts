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
