import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = ['kanban-worker', 'refining-kanban-captures'] as const;
export type PackagedSkill = (typeof SKILLS)[number];

/**
 * Resolve `<packageRoot>/skill/<skill>/SKILL.md`. The compiled entrypoint lives
 * in `build/`, the sources in `src/commands/`, so walk up until the `skill`
 * directory appears rather than hard-coding one depth.
 */
function packagedSkillPath(skill: string): string {
    let dir = dirname(fileURLToPath(import.meta.url));

    for (let depth = 0; depth < 5; depth += 1) {
        const candidate = join(dir, 'skill', skill, 'SKILL.md');
        if (existsSync(candidate)) return candidate;
        dir = dirname(dir);
    }

    throw new Error(`packaged skill '${skill}' was not found on disk`);
}

export interface InstallSkillOptions {
    mode?: 'symlink' | 'copy';
    skill?: string;
}

export function installSkill(target: string, options: InstallSkillOptions = {}) {
    const mode = options.mode ?? 'copy';

    if (options.skill && !SKILLS.includes(options.skill as PackagedSkill)) {
        throw new Error(`unknown skill '${options.skill}'; packaged skills are: ${SKILLS.join(', ')}`);
    }

    const requested = options.skill ? [options.skill] : [...SKILLS];
    const installed: Array<{ skill: string; path: string; mode: string }> = [];
    const skipped: Array<{ skill: string; path: string; reason: 'already_installed' }> = [];

    for (const skill of requested) {
        const destDir = join(target, skill);
        const destFile = join(destDir, 'SKILL.md');

        if (existsSync(destFile)) {
            skipped.push({ skill, path: destFile, reason: 'already_installed' });
            continue;
        }

        mkdirSync(destDir, { recursive: true });
        const source = packagedSkillPath(skill);

        if (mode === 'symlink') symlinkSync(source, destFile);
        else copyFileSync(source, destFile);

        installed.push({ skill, path: destFile, mode });
    }

    return { ok: true as const, installed, skipped };
}
