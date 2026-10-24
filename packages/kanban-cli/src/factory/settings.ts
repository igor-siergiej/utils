export interface FactorySettings {
    auto: boolean;
    /** false when the note is missing or has no readable `auto:` line. */
    valid: boolean;
}

export const SETTINGS_NOTE = 'factory/settings';
export const STATUS_NOTE = 'factory/status';

export function parseSettings(body: string | undefined): FactorySettings {
    const match = body?.match(/^\s*auto:\s*(\S+)\s*$/m);
    const value = match?.[1].toLowerCase();
    if (value === 'on' || value === 'off') return { auto: value === 'on', valid: true };
    return { auto: false, valid: false };
}

export interface FactoryStatus {
    state: 'idle' | 'running' | 'paused';
    card?: string;
    pausedUntil?: string;
    updated: string;
    note?: string;
}

export function formatStatus(s: FactoryStatus): string {
    const lines = [`state: ${s.state}${s.card ? ` ${s.card}` : ''}`];
    if (s.pausedUntil) lines.push(`paused_until: ${s.pausedUntil}`);
    lines.push(`updated: ${s.updated}`);
    if (s.note) lines.push(`note: ${s.note}`);
    return `${lines.join('\n')}\n`;
}
