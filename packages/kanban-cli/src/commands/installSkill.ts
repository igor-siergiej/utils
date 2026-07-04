import { copyFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function packagedSkillPath(): string {
    // build/cli.{js,mjs} -> ../skill/SKILL.md (the package root's skill/ directory).
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'skill', 'SKILL.md');
}

export interface InstallSkillOptions {
    mode?: 'symlink' | 'copy';
}

export function installSkill(target: string, options: InstallSkillOptions = {}) {
    const mode = options.mode ?? 'copy';
    const destDir = join(target, 'kanban-worker');
    const destFile = join(destDir, 'SKILL.md');

    if (existsSync(destFile)) {
        return { ok: false as const, error: 'already_installed', path: destFile };
    }

    mkdirSync(destDir, { recursive: true });
    const source = packagedSkillPath();

    if (mode === 'symlink') {
        symlinkSync(source, destFile);
    } else {
        copyFileSync(source, destFile);
    }

    return { ok: true as const, path: destFile, mode };
}
