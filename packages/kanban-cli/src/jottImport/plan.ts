import { parse as parseYaml } from 'yaml';
import { parseKanbanFile } from '../kanban/parser';
import { INBOX_COLUMN, type KanbanItem } from '../kanban/types';

export type JottStatus = 'inbox' | 'backlog' | 'in_progress' | 'blocked' | 'done';

export interface ImportFile {
    name: string;
    text: string;
}

export interface ImportTask {
    source: string;
    project: string | null;
    status: JottStatus;
    title: string;
    tags: string[];
    body: string;
    meta: Record<string, unknown>;
}

export interface ImportPlan {
    tasks: ImportTask[];
    skipped: string[];
}

const BOARD_COLUMNS: Record<string, JottStatus> = {
    Backlog: 'backlog',
    'In Progress': 'in_progress',
    Blocked: 'blocked',
    Done: 'done',
};

const CHECKLIST_SECTIONS: Record<string, JottStatus> = {
    'in progress': 'in_progress',
    todo: 'backlog',
    backlog: 'backlog',
    done: 'done',
};

const HASHTAG = /(^|\s)#([A-Za-z][\w-]*)/g;
const PRIORITY = /\[(P[1-3])\]/g;
const MAX_TITLE = 80;

function frontmatter(text: string): Record<string, unknown> {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return {};
    const parsed = parseYaml(m[1]);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

/** First sentence of the first line, cut to 80 chars at a word boundary. */
export function captureTitle(text: string): string {
    const firstLine = text.split('\n')[0].trim();
    const sentence = /^(.*?[.?!])(\s|$)/.exec(firstLine)?.[1] ?? firstLine;
    if (sentence.length <= MAX_TITLE) return sentence;
    const cut = sentence.slice(0, MAX_TITLE + 1);
    const space = cut.lastIndexOf(' ');
    return (space > 0 ? cut.slice(0, space) : cut.slice(0, MAX_TITLE)).trimEnd();
}

/** Top-level `- ` bullets with their indented continuation lines; any other line closes the bullet. */
function bullets(lines: string[]): string[] {
    const out: string[][] = [];
    let open = false;
    for (const line of lines) {
        if (line.startsWith('- ')) {
            out.push([line.slice(2).trim()]);
            open = true;
        } else if (open && /^\s+\S/.test(line)) {
            out[out.length - 1].push(line.trim());
        } else {
            open = false;
        }
    }
    return out.map((b) => b.join('\n'));
}

/** Title by the capture rule; the full text opens the body only when the title is shorter. */
function titled(text: string, continuation = ''): { title: string; body: string } {
    const title = captureTitle(text);
    const lead = title === text ? '' : text;
    return { title, body: [lead, continuation].filter(Boolean).join('\n\n') };
}

function itemMeta(item: KanbanItem, repoUrl: string | undefined): Record<string, unknown> {
    const meta: Record<string, unknown> = { slug: item.id };
    if (item.branch) meta.branch = item.branch;
    if (item.pr !== undefined) meta.pr = item.pr;
    if (item.mergedCommit) meta.merged_commit = item.mergedCommit;
    if (item.revertPr !== undefined) meta.revert_pr = item.revertPr;
    meta.retries = item.retries;
    if (item.blockedReason) meta.blocked_reason = item.blockedReason;
    if (item.completedAt) meta.completed_at = item.completedAt;
    if (repoUrl) meta.repo_url = repoUrl;
    return meta;
}

function boardTasks(file: ImportFile): ImportTask[] {
    let board: ReturnType<typeof parseKanbanFile>;
    try {
        board = parseKanbanFile(file.text);
    } catch (cause) {
        throw new Error(`${file.name}: ${(cause as Error).message}`);
    }
    const project = board.project?.trim();
    if (!project) throw new Error(`${file.name}: missing 'project' frontmatter`);
    const repoMeta = board.repoUrl ? { repo_url: board.repoUrl } : {};
    const tasks: ImportTask[] = [];

    for (const column of board.columns) {
        if (column.name === INBOX_COLUMN) {
            for (const block of column.captures) {
                const lines = block.split('\n');
                const texts = lines[0].startsWith('- ') ? bullets(lines) : [lines.map((l) => l.trim()).join('\n')];
                for (const text of texts) {
                    const { title } = titled(text);
                    tasks.push({
                        source: file.name,
                        project,
                        status: 'inbox',
                        title,
                        tags: [],
                        body: text,
                        meta: { ...repoMeta },
                    });
                }
            }
            continue;
        }
        const status = BOARD_COLUMNS[column.name];
        if (!status) throw new Error(`${file.name}: unknown column '${column.name}'`);
        for (const item of column.items) {
            tasks.push({
                source: file.name,
                project,
                status,
                title: item.title,
                tags: item.tags ?? [],
                body: item.body.trim(),
                meta: itemMeta(item, board.repoUrl),
            });
        }
    }
    return tasks;
}

function checklistTask(source: string, project: string, status: JottStatus, lines: string[]): ImportTask {
    const tags = new Set<string>();
    const text = lines[0]
        .replace(PRIORITY, (_, p: string) => {
            tags.add(p);
            return '';
        })
        .replace(HASHTAG, (_, lead: string, name: string) => {
            tags.add(name);
            return lead;
        })
        .replace(/[ \t]+/g, ' ')
        .trim();
    const { title, body } = titled(text, lines.slice(1).join('\n'));
    return { source, project, status, title, tags: [...tags], body, meta: {} };
}

/** null when the file is not a checklist board (no project, or no In Progress/Todo/Backlog section). */
function checklistTasks(file: ImportFile): ImportTask[] | null {
    const project = frontmatter(file.text).project;
    if (typeof project !== 'string' || project.trim() === '') return null;
    const lines = file.text.split(/\r?\n/);
    const isChecklist = lines.some((l) => {
        const s = l.startsWith('## ') ? CHECKLIST_SECTIONS[l.slice(3).trim().toLowerCase()] : undefined;
        return s !== undefined && s !== 'done';
    });
    if (!isChecklist) return null;

    const tasks: ImportTask[] = [];
    let section: JottStatus | undefined;
    let current: { status: JottStatus; lines: string[] } | null = null;
    const flush = () => {
        if (current) tasks.push(checklistTask(file.name, project.trim(), current.status, current.lines));
        current = null;
    };

    for (const line of lines) {
        if (/^#{1,6} /.test(line)) {
            flush();
            if (line.startsWith('## ')) section = CHECKLIST_SECTIONS[line.slice(3).trim().toLowerCase()];
            continue;
        }
        const box = /^- \[([ xX])\] (.*)$/.exec(line);
        if (box && section) {
            flush();
            current = { status: box[1] === ' ' ? section : 'done', lines: [box[2]] };
            continue;
        }
        if (current && /^\s+\S/.test(line)) {
            current.lines.push(line.trim());
            continue;
        }
        flush();
    }
    flush();
    return tasks;
}

function inboxTasks(file: ImportFile, projects: string[]): ImportTask[] {
    const body = file.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    return bullets(body.split(/\r?\n/)).map((raw) => {
        let project: string | null = null;
        const text = raw
            .replace(HASHTAG, (whole: string, lead: string, name: string) => {
                const match = projects.find((p) => p.toLowerCase() === name.toLowerCase());
                if (!match || project) return whole;
                project = match;
                return lead;
            })
            .replace(/[ \t]+/g, ' ')
            .trim();
        const { title, body: taskBody } = titled(text);
        return { source: file.name, project, status: 'inbox' as const, title, tags: [], body: taskBody, meta: {} };
    });
}

/** Parses every file before returning, so one bad file aborts the import before anything is written. */
export function planImport(files: ImportFile[]): ImportPlan {
    const tasks: ImportTask[] = [];
    const skipped: string[] = [];
    let inbox: ImportFile | undefined;

    for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
        if (file.name.endsWith('.board.md')) {
            tasks.push(...boardTasks(file));
        } else if (file.name === 'inbox.md') {
            inbox = file;
        } else {
            const checklist = checklistTasks(file);
            if (checklist) tasks.push(...checklist);
            else skipped.push(file.name);
        }
    }

    if (inbox) {
        const projects = [...new Set(tasks.map((t) => t.project).filter((p): p is string => p !== null))];
        tasks.push(...inboxTasks(inbox, projects));
    }
    return { tasks, skipped };
}
