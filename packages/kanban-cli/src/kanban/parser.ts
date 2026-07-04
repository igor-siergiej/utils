import { parse as parseYamlDocument } from 'yaml';
import { KanbanParseError } from './errors';
import type { KanbanBoard, KanbanColumn, KanbanItem, RetryCounters } from './types';

const TITLE_HEADING = /^#\s+(.+?)\s*$/;
const COLUMN_HEADING = /^##\s+(.+?)\s*$/;
const ITEM_HEADING = /^###\s+(.+?)\s*$/;
const YAML_FENCE_START = /^```ya?ml\s*$/;
const YAML_FENCE_END = /^```\s*$/;

const DEFAULT_RETRIES: RetryCounters = { implement: 0, e2e_local: 0, ci: 0, deploy: 0, e2e_live: 0 };

/**
 * A lone `---` line always terminates an item's body, in addition to the next
 * heading. This is what lets the serializer emit a visual divider after every
 * item without that divider being re-captured as body text on the next parse
 * (which would otherwise accumulate a growing pile of `---` on every round trip).
 */
const BODY_SEPARATOR = /^---\s*$/;

export function parseKanbanFile(markdown: string): KanbanBoard {
    const lines = markdown.split(/\r?\n/);

    let title = 'Kanban Board';
    const columns: KanbanColumn[] = [];
    const seenIds = new Set<string>();

    let currentColumn: KanbanColumn | null = null;
    let i = 0;

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

    return { title, columns };
}

function parseItem(lines: string[], start: number, itemTitle: string): { item: KanbanItem; nextIndex: number } {
    let i = start;

    while (i < lines.length && lines[i].trim() === '') i += 1;

    if (i >= lines.length || !YAML_FENCE_START.test(lines[i])) {
        throw new KanbanParseError(`Item '${itemTitle}' is missing its yaml metadata block`);
    }
    i += 1;

    const yamlLines: string[] = [];
    while (i < lines.length && !YAML_FENCE_END.test(lines[i])) {
        yamlLines.push(lines[i]);
        i += 1;
    }
    if (i >= lines.length) {
        throw new KanbanParseError(`Item '${itemTitle}' has an unterminated yaml metadata block`);
    }
    i += 1;

    let meta: Record<string, unknown>;
    try {
        meta = (parseYamlDocument(yamlLines.join('\n')) ?? {}) as Record<string, unknown>;
    } catch (cause) {
        throw new KanbanParseError(`Item '${itemTitle}' has invalid yaml metadata: ${(cause as Error).message}`);
    }

    if (typeof meta.id !== 'string' || meta.id.trim() === '') {
        throw new KanbanParseError(`Item '${itemTitle}' is missing a required 'id' field`);
    }
    if (typeof meta.repo !== 'string' || meta.repo.trim() === '') {
        throw new KanbanParseError(`Item '${meta.id}' is missing a required 'repo' field`);
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

    const retries: RetryCounters = {
        ...DEFAULT_RETRIES,
        ...(meta.retries as Partial<RetryCounters> | undefined),
    };

    const item: KanbanItem = {
        id: meta.id,
        title: itemTitle,
        column: '',
        repo: meta.repo,
        body: trimBlankEdges(bodyLines),
        retries,
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : undefined,
        branch: typeof meta.branch === 'string' ? meta.branch : undefined,
        pr: typeof meta.pr === 'number' ? meta.pr : undefined,
        mergedCommit: typeof meta.merged_commit === 'string' ? meta.merged_commit : undefined,
        revertPr: typeof meta.revert_pr === 'number' ? meta.revert_pr : undefined,
        blockedReason: typeof meta.blocked_reason === 'string' ? meta.blocked_reason : undefined,
        completedAt: typeof meta.completed_at === 'string' ? meta.completed_at : undefined,
    };

    return { item, nextIndex: i };
}

function trimBlankEdges(lines: string[]): string {
    const trimmed = [...lines];
    while (trimmed.length && trimmed[0].trim() === '') trimmed.shift();
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
    return trimmed.join('\n');
}
