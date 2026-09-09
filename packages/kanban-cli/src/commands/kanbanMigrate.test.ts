import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kanbanMigrate } from './kanbanMigrate';

let dir: string;
let boardPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kanban-cli-migrate-'));
    boardPath = join(dir, 'board.md');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const OLD_FORMAT = `# Shoppingo Board

## Backlog

### Add dark mode

\`\`\`yaml
id: shoppingo-042
repo: /home/igor/dev/shoppingo
tags:
  - ui
retries:
  implement: 0
  e2e_local: 1
  ci: 0
  deploy: 0
  e2e_live: 0
\`\`\`

Body text.

---

## In Progress
## Blocked
## Done
`;

describe('kanbanMigrate', () => {
    it('rewrites an old-format board to bullets with injected project frontmatter', () => {
        writeFileSync(boardPath, OLD_FORMAT);
        const result = kanbanMigrate(boardPath, { project: 'shoppingo' });

        expect(result).toEqual({ ok: true, project: 'shoppingo', path: boardPath });

        const out = readFileSync(boardPath, 'utf8');
        expect(out).toMatch(/^---\nproject: shoppingo\n---\n/);
        expect(out).not.toContain('```yaml');
        expect(out).toContain('- **id:** shoppingo-042');
        expect(out).toContain('- **tags:** ui');
        expect(out).toContain('- **retries:** implement 0, e2e_local 1, ci 0, deploy 0, e2e_live 0');
        expect(out).not.toContain('repo:');
    });

    it('is idempotent on an already-migrated board', () => {
        writeFileSync(boardPath, OLD_FORMAT);
        kanbanMigrate(boardPath, { project: 'shoppingo' });
        const once = readFileSync(boardPath, 'utf8');
        kanbanMigrate(boardPath, {});
        expect(readFileSync(boardPath, 'utf8')).toBe(once);
    });

    it('throws when the board has no project and none is passed', () => {
        writeFileSync(boardPath, OLD_FORMAT);
        expect(() => kanbanMigrate(boardPath, {})).toThrow(/project/);
    });
});
