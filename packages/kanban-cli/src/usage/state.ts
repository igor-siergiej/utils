import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import type { UsageState } from './types';

export function defaultUsageStatePath(): string {
    return process.env.KANBAN_CLI_USAGE_STATE_PATH ?? join(homedir(), '.claude', 'kanban-cli', 'usage-state.json');
}

const usageStateSchema = z.object({ usedPct: z.number(), resetsAt: z.string(), recordedAt: z.string() });

export function readUsageState(path: string): UsageState | undefined {
    if (!existsSync(path)) return undefined;

    try {
        return usageStateSchema.safeParse(JSON.parse(readFileSync(path, 'utf8'))).data;
    } catch {
        return undefined;
    }
}

export function writeUsageState(path: string, state: UsageState): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
}
