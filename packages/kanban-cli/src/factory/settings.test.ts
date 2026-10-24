import { describe, expect, it } from 'vitest';
import { formatStatus, parseSettings } from './settings';

describe('parseSettings', () => {
    it('reads auto on and off', () => {
        expect(parseSettings('auto: on')).toEqual({ auto: true, valid: true });
        expect(parseSettings('# factory\nauto: off\n')).toEqual({ auto: false, valid: true });
    });

    it('treats a missing or unreadable note as auto off', () => {
        expect(parseSettings(undefined)).toEqual({ auto: false, valid: false });
        expect(parseSettings('auto: maybe')).toEqual({ auto: false, valid: false });
        expect(parseSettings('just some text')).toEqual({ auto: false, valid: false });
    });
});

describe('formatStatus', () => {
    it('writes one key: value line per set field', () => {
        expect(formatStatus({ state: 'running', card: 'tandra#42', updated: '2026-10-24T20:00:00.000Z' })).toBe(
            'state: running tandra#42\nupdated: 2026-10-24T20:00:00.000Z\n'
        );
        expect(
            formatStatus({
                state: 'paused',
                pausedUntil: '2026-10-24T21:40:00.000Z',
                updated: '2026-10-24T20:00:00.000Z',
                note: 'x',
            })
        ).toBe('state: paused\npaused_until: 2026-10-24T21:40:00.000Z\nupdated: 2026-10-24T20:00:00.000Z\nnote: x\n');
    });
});
