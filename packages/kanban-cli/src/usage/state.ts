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
