import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSkill } from './installSkill';

const target = () => mkdtempSync(join(tmpdir(), 'kanban-skills-'));

describe('installSkill', () => {
    it('installs every packaged skill by default', () => {
        const dir = target();
        const result = installSkill(dir);

        expect(result.ok).toBe(true);
        expect(result.installed.map((entry) => entry.skill).sort()).toEqual([
            'kanban-worker',
            'refining-kanban-captures',
        ]);
        expect(existsSync(join(dir, 'kanban-worker', 'SKILL.md'))).toBe(true);
        expect(existsSync(join(dir, 'refining-kanban-captures', 'SKILL.md'))).toBe(true);
    });

    it('installs only the named skill', () => {
        const dir = target();
        const result = installSkill(dir, { skill: 'refining-kanban-captures' });

        expect(result.installed.map((entry) => entry.skill)).toEqual(['refining-kanban-captures']);
        expect(existsSync(join(dir, 'kanban-worker'))).toBe(false);
    });

    it('skips an already-installed skill while installing a new one', () => {
        const dir = target();
        mkdirSync(join(dir, 'kanban-worker'), { recursive: true });
        writeFileSync(join(dir, 'kanban-worker', 'SKILL.md'), 'existing');

        const result = installSkill(dir);

        expect(result.skipped.map((entry) => entry.skill)).toEqual(['kanban-worker']);
        expect(result.installed.map((entry) => entry.skill)).toEqual(['refining-kanban-captures']);
    });

    it('never overwrites an already-installed skill', () => {
        const dir = target();
        mkdirSync(join(dir, 'kanban-worker'), { recursive: true });
        writeFileSync(join(dir, 'kanban-worker', 'SKILL.md'), 'existing');

        installSkill(dir);

        expect(readFileSync(join(dir, 'kanban-worker', 'SKILL.md'), 'utf8')).toBe('existing');
    });

    it('errors on an unknown skill name', () => {
        expect(() => installSkill(target(), { skill: 'nope' })).toThrow(/nope/);
    });
});
