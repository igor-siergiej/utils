import { describe, expect, it } from 'vitest';
import { captureTitle, planImport } from './plan';

const ZERO = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

const bulletBoard = `---
project: app
repoUrl: git@github.com:me/app.git
---

# App

## Inbox

- first capture. More words here
- second capture
  continued

A paragraph capture

## Backlog

### Do the thing

- **id:** app-do-thing
- **tags:** ui, P1
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0

Body text.

**Acceptance**
- works

## In Progress

## Blocked

### Stuck one

- **id:** app-stuck
- **branch:** feat/stuck
- **pr:** 118
- **retries:** implement 0, e2e_local 0, ci 2, deploy 0, e2e_live 0
- **blocked_reason:** ci red

## Done

### Shipped

- **id:** app-shipped
- **merged_commit:** abc123
- **revert_pr:** 120
- **retries:** implement 0, e2e_local 0, ci 0, deploy 0, e2e_live 0
- **completed_at:** 2026-10-01T10:00:00Z
`;

const legacyBoard = `---
project: old
---

# Old

## Backlog

## In Progress

## Blocked

### Legacy card

\`\`\`yaml
id: old-legacy
repo: /home/x/old
tags:
  - bug
retries:
  implement: 1
  e2e_local: 0
  ci: 0
  deploy: 0
  e2e_live: 0
blocked_reason: "needs a device"
\`\`\`

Legacy body.

## Done
`;

const checklist = `---
project: mix
tags: [foundry]
---

## In Progress

- [ ] half done thing #ux

## TODO

- [x] add register page? — done #14

## Backlog

Audit notes (prose, ignored):

### Security
- [ ] SSE stream IDOR: never checks owner. Add a test for it please and also make sure the whole thing is long enough to cut [P1] #bug #security
  continuation line

## Done

- [x] old thing
`;

const designNote = `---
project: cycling-app
type: idea
---

## Guiding principles

- not a task
`;

const inbox = `---
type: inbox
---

# Inbox

Dump anything here. Hint: \`#<project>\`.

- drive upgrade?is the db on ssd
- tidy #mix things
- idea for #nobody
`;

const index = `---
type: index
---

# Kanban Index
`;

const files = [
    { name: 'app.board.md', text: bulletBoard },
    { name: 'old.board.md', text: legacyBoard },
    { name: 'mix.md', text: checklist },
    { name: 'cycling-app.md', text: designNote },
    { name: 'inbox.md', text: inbox },
    { name: 'index.md', text: index },
];

describe('captureTitle', () => {
    it('takes the first sentence', () => expect(captureTitle('Fix it. Then more')).toBe('Fix it.'));
    it('keeps a ?/! glued to the next word', () =>
        expect(captureTitle('drives?is the db on ssd')).toBe('drives?is the db on ssd'));
    it('cuts long text at a word boundary within 80 chars', () => {
        const t = captureTitle(`${'word '.repeat(30)}end`);
        expect(t.length).toBeLessThanOrEqual(80);
        expect(t.endsWith('word')).toBe(true);
    });
});

describe('planImport', () => {
    const plan = planImport(files);
    const by = (source: string) => plan.tasks.filter((t) => t.source === source);

    it('maps worker board items with every meta key and type', () => {
        const app = by('app.board.md').filter((t) => t.status !== 'inbox');
        expect(app.map((t) => [t.title, t.status])).toEqual([
            ['Do the thing', 'backlog'],
            ['Stuck one', 'blocked'],
            ['Shipped', 'done'],
        ]);
        expect(app[0]).toMatchObject({
            project: 'app',
            tags: ['ui', 'P1'],
            meta: { slug: 'app-do-thing', retries: ZERO, repo_url: 'git@github.com:me/app.git' },
        });
        expect(app[0].body).toBe('Body text.\n\n**Acceptance**\n- works');
        expect(app[1].meta).toEqual({
            slug: 'app-stuck',
            branch: 'feat/stuck',
            pr: 118,
            retries: { ...ZERO, ci: 2 },
            blocked_reason: 'ci red',
            repo_url: 'git@github.com:me/app.git',
        });
        expect(app[2].meta).toMatchObject({
            merged_commit: 'abc123',
            revert_pr: 120,
            completed_at: '2026-10-01T10:00:00Z',
        });
    });

    it('splits board inbox bullet blocks, keeps paragraph blocks whole', () => {
        const caps = by('app.board.md').filter((t) => t.status === 'inbox');
        expect(caps.map((t) => t.title)).toEqual(['first capture.', 'second capture', 'A paragraph capture']);
        expect(caps[0].body).toBe('first capture. More words here');
        expect(caps[1].body).toBe('second capture\ncontinued');
        expect(caps.every((t) => t.project === 'app')).toBe(true);
    });

    it('reads the legacy yaml format and drops its repo field', () => {
        const [t] = by('old.board.md');
        expect(t).toMatchObject({ title: 'Legacy card', status: 'blocked', tags: ['bug'], body: 'Legacy body.' });
        expect(t.meta).toEqual({
            slug: 'old-legacy',
            retries: { ...ZERO, implement: 1 },
            blocked_reason: 'needs a device',
        });
    });

    it('turns checklist bullets into tasks by section', () => {
        const mix = by('mix.md');
        expect(mix.map((t) => t.status)).toEqual(['in_progress', 'done', 'backlog', 'done']);
        expect(mix[0]).toMatchObject({ title: 'half done thing', tags: ['ux'], body: '', meta: {} });
        // `#14` is not a tag (no letter after #); the title stops at the first sentence.
        expect(mix[1]).toMatchObject({ title: 'add register page?', tags: [], body: 'add register page? — done #14' });
        expect(mix[2].tags).toEqual(['P1', 'bug', 'security']);
        expect(mix[2].title).toBe('SSE stream IDOR: never checks owner.');
        expect(mix[2].body).toBe(
            'SSE stream IDOR: never checks owner. Add a test for it please and also make sure the whole thing is long enough to cut\n\ncontinuation line'
        );
    });

    it('routes inbox.md bullets by #project hint', () => {
        const ib = by('inbox.md');
        expect(ib.map((t) => [t.title, t.project, t.status])).toEqual([
            ['drive upgrade?is the db on ssd', null, 'inbox'],
            ['tidy things', 'mix', 'inbox'],
            ['idea for #nobody', null, 'inbox'],
        ]);
    });

    it('lists files it does not import', () => {
        expect(plan.skipped.sort()).toEqual(['cycling-app.md', 'index.md']);
    });

    it('aborts on an unknown worker column', () => {
        const bad = bulletBoard.replace('## In Progress', '## Review');
        expect(() => planImport([{ name: 'app.board.md', text: bad }])).toThrow(
            /app.board.md: unknown column 'Review'/
        );
    });
});
