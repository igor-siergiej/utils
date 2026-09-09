import { parse as parseYamlDocument } from 'yaml';
import { KanbanParseError } from './errors';
import type { KanbanBoard, KanbanColumn, KanbanItem, RetryCounters, RetryGate } from './types';
import { RETRY_GATES } from './types';

const TITLE_HEADING = /^#\s+(.+?)\s*$/;
const COLUMN_HEADING = /^##\s+(.+?)\s*$/;
const ITEM_HEADING = /^###\s+(.+?)\s*$/;
const YAML_FENCE_START = /^```ya?ml\s*$/;
const YAML_FENCE_END = /^```\s*$/;
const META_BULLET = /^-\s+\*\*([a-z_]+):\*\*\s?(.*)$/;

const KNOWN_KEYS = new Set([
    'id',
    'repo',
    'tags',
    'branch',
    'pr',
    'merged_commit',
    'revert_pr',
    'retries',
    'blocked_reason',
    'completed_at',
]);

const DEFAULT_RETRIES: RetryCounters = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

/**
 * A lone `---` line always terminates an item's body, in addition to the next
 * heading. This is what lets the serializer emit a visual divider after every
 * item without that divider being re-captured as body text on the next parse.
 */
const BODY_SEPARATOR = /^---\s*$/;

export function parseKanbanFile(markdown: string): KanbanBoard {
    const lines = markdown.split(/\r?\n/);

    let title = 'Kanban Board';
    let project: string | undefined;
    const columns: KanbanColumn[] = [];
    const seenIds = new Set<string>();

    let currentColumn: KanbanColumn | null = null;
    let i = 0;

    if (lines[0]?.trim() === '---') {
        let end = 1;
        while (end < lines.length && lines[end].trim() !== '---') end += 1;
        if (end >= lines.length) {
            throw new KanbanParseError('Board frontmatter is not terminated by a closing ---');
        }
        let front: Record<string, unknown>;
        try {
            front = (parseYamlDocument(lines.slice(1, end).join('\n')) ?? {}) as Record<string, unknown>;
        } catch (cause) {
            throw new KanbanParseError(`Board frontmatter is not valid yaml: ${(cause as Error).message}`);
        }
        if (typeof front.project !== 'string' || front.project.trim() === '') {
            throw new KanbanParseError("Board frontmatter is missing a required 'project' field");
        }
        project = front.project;
        i = end + 1;
    }

    while (i < lines.length) {
        const line = lines[i];

        const titleMatch = line.match(TITLE_HEADING);
        if (titleMatch && columns.length === 0 && !currentColumn) {
            title = titleMatch[1];
            i += 1;
            continue;
        }

        const columnMatch = line.match(COLUMN_HEADING);
        if (columnMatch) {
            currentColumn = { name: columnMatch[1], items: [] };
            columns.push(currentColumn);
            i += 1;
            continue;
        }

        const itemMatch = line.match(ITEM_HEADING);
        if (itemMatch) {
            if (!currentColumn) {
                throw new KanbanParseError(`Item heading '${itemMatch[1]}' appears before any column (##) heading`);
            }

            const parsed = parseItem(lines, i + 1, itemMatch[1]);

            if (seenIds.has(parsed.item.id)) {
                throw new KanbanParseError(`Duplicate item id '${parsed.item.id}'`);
            }
            seenIds.add(parsed.item.id);

            currentColumn.items.push({ ...parsed.item, column: currentColumn.name });
            i = parsed.nextIndex;
            continue;
        }

        i += 1;
    }

    return { title, project, columns };
}

function parseItem(lines: string[], start: number, itemTitle: string): { item: KanbanItem; nextIndex: number } {
    let i = start;
    while (i < lines.length && lines[i].trim() === '') i += 1;

    let meta: Record<string, unknown>;
    if (i < lines.length && YAML_FENCE_START.test(lines[i])) {
        ({ meta, nextIndex: i } = parseYamlMeta(lines, i, itemTitle));
    } else if (
        i < lines.length &&
        META_BULLET.test(lines[i]) &&
        KNOWN_KEYS.has(lines[i].match(META_BULLET)?.[1] ?? '')
    ) {
        ({ meta, nextIndex: i } = parseBulletMeta(lines, i));
    } else {
        throw new KanbanParseError(`Item '${itemTitle}' is missing its metadata block`);
    }

    if (typeof meta.id !== 'string' || meta.id.trim() === '') {
        throw new KanbanParseError(`Item '${itemTitle}' is missing a required 'id' field`);
    }

    const bodyLines: string[] = [];
    while (
        i < lines.length &&
        !COLUMN_HEADING.test(lines[i]) &&
        !ITEM_HEADING.test(lines[i]) &&
        !BODY_SEPARATOR.test(lines[i])
    ) {
        bodyLines.push(lines[i]);
        i += 1;
    }
    if (i < lines.length && BODY_SEPARATOR.test(lines[i])) {
        i += 1;
    }

    const item: KanbanItem = {
        id: meta.id,
        title: itemTitle,
        column: '',
        repo: typeof meta.repo === 'string' ? meta.repo : '',
        body: trimBlankEdges(bodyLines),
        retries: coerceRetries(meta.retries),
        tags: coerceTags(meta.tags),
        branch: typeof meta.branch === 'string' ? meta.branch : undefined,
        pr: coerceNumber(meta.pr),
        mergedCommit: typeof meta.merged_commit === 'string' ? meta.merged_commit : undefined,
        revertPr: coerceNumber(meta.revert_pr),
        blockedReason: typeof meta.blocked_reason === 'string' ? meta.blocked_reason : undefined,
        completedAt: typeof meta.completed_at === 'string' ? meta.completed_at : undefined,
    };

    return { item, nextIndex: i };
}

function parseYamlMeta(
    lines: string[],
    fenceStart: number,
    itemTitle: string
): { meta: Record<string, unknown>; nextIndex: number } {
    let i = fenceStart + 1;
    const yamlLines: string[] = [];
    while (i < lines.length && !YAML_FENCE_END.test(lines[i])) {
        yamlLines.push(lines[i]);
        i += 1;
    }
    if (i >= lines.length) {
        throw new KanbanParseError(`Item '${itemTitle}' has an unterminated yaml metadata block`);
    }
    i += 1;

    try {
        return { meta: (parseYamlDocument(yamlLines.join('\n')) ?? {}) as Record<string, unknown>, nextIndex: i };
    } catch (cause) {
        throw new KanbanParseError(`Item '${itemTitle}' has invalid yaml metadata: ${(cause as Error).message}`);
    }
}

function parseBulletMeta(lines: string[], start: number): { meta: Record<string, unknown>; nextIndex: number } {
    const meta: Record<string, unknown> = {};
    let i = start;
    while (i < lines.length) {
        const match = lines[i].match(META_BULLET);
        if (!match || !KNOWN_KEYS.has(match[1])) break;
        meta[match[1]] = match[2].trim();
        i += 1;
    }
    return { meta, nextIndex: i };
}

function coerceRetries(raw: unknown): RetryCounters {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return { ...DEFAULT_RETRIES, ...(raw as Partial<RetryCounters>) };
    }
    if (typeof raw !== 'string' || raw.trim() === '') return { ...DEFAULT_RETRIES };

    const counters: RetryCounters = { ...DEFAULT_RETRIES };
    for (const pair of raw.split(',')) {
        const [gate, value] = pair.trim().split(/\s+/);
        if (!RETRY_GATES.includes(gate as RetryGate)) {
            throw new KanbanParseError(`Unknown retry gate '${gate}' in retries metadata`);
        }
        counters[gate as RetryGate] = Number(value) || 0;
    }
    return counters;
}

function coerceTags(raw: unknown): string[] | undefined {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string' && raw.trim() !== '') {
        return raw
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    }
    return undefined;
}

function coerceNumber(raw: unknown): number | undefined {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
    return undefined;
}

function trimBlankEdges(lines: string[]): string {
    const trimmed = [...lines];
    while (trimmed.length && trimmed[0].trim() === '') trimmed.shift();
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
    return trimmed.join('\n');
}
