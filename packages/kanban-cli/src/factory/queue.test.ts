import { describe, expect, it } from 'vitest';
import { type JottTask, nextCard } from './queue';

const NOW = Date.parse('2026-10-24T20:00:00.000Z');
const card = (number: number, status: string, meta: Record<string, unknown> = {}, position = number): JottTask => ({
    number,
    title: `card ${number}`,
    project: 'tandra',
    status,
    tags: [],
    meta,
    position,
});

describe('nextCard', () => {
    it('resumes a paused card whose reset has passed before anything else', () => {
        const tasks = [
            card(1, 'todo', { go: true }),
            card(2, 'in_progress', { paused_until: '2026-10-24T19:00:00.000Z' }),
        ];

        expect(nextCard(tasks, { auto: true }, NOW)?.number).toBe(2);
    });

    it('leaves a card paused until its reset', () => {
        const tasks = [card(2, 'in_progress', { paused_until: '2026-10-24T21:00:00.000Z' })];

        expect(nextCard(tasks, { auto: true }, NOW)).toBeUndefined();
    });

    it('runs go cards before plain todo, even with auto off', () => {
        const tasks = [card(1, 'todo', {}, 0), card(5, 'todo', { go: true }, 9)];

        expect(nextCard(tasks, { auto: true }, NOW)?.number).toBe(5);
        expect(nextCard(tasks, { auto: false }, NOW)?.number).toBe(5);
    });

    it('takes plain todo in board order only when auto is on', () => {
        const tasks = [card(7, 'todo', {}, 2), card(3, 'todo', {}, 1), card(4, 'todo', {}, 1)];

        expect(nextCard(tasks, { auto: true }, NOW)?.number).toBe(3);
        expect(nextCard(tasks, { auto: false }, NOW)).toBeUndefined();
    });

    it('never picks inbox, backlog, blocked or done, whatever their meta says', () => {
        const tasks = ['inbox', 'backlog', 'blocked', 'done'].map((s, i) => card(i + 1, s, { go: true }));

        expect(nextCard(tasks, { auto: true }, NOW)).toBeUndefined();
    });
});
