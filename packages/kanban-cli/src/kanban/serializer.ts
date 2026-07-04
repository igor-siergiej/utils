import { stringify as stringifyYamlDocument } from 'yaml';
import type { KanbanBoard, KanbanItem } from './types';

export function serializeKanbanBoard(board: KanbanBoard): string {
    const lines: string[] = [`# ${board.title}`, ''];

    for (const column of board.columns) {
        lines.push(`## ${column.name}`, '');

        for (const item of column.items) {
            lines.push(`### ${item.title}`, '', '```yaml', ...serializeMeta(item).split('\n'), '```', '');

            if (item.body) {
                lines.push(item.body, '');
            }

            lines.push('---', '');
        }
    }

    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines[lines.length - 1] === '---') lines.pop();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    return `${lines.join('\n')}\n`;
}

function serializeMeta(item: KanbanItem): string {
    const meta: Record<string, unknown> = {
        id: item.id,
        repo: item.repo,
    };

    if (item.tags?.length) meta.tags = item.tags;
    if (item.branch) meta.branch = item.branch;
    if (item.pr !== undefined) meta.pr = item.pr;
    if (item.mergedCommit) meta.merged_commit = item.mergedCommit;
    if (item.revertPr !== undefined) meta.revert_pr = item.revertPr;
    meta.retries = item.retries;
    if (item.blockedReason) meta.blocked_reason = item.blockedReason;
    if (item.completedAt) meta.completed_at = item.completedAt;

    return stringifyYamlDocument(meta, { lineWidth: 0 }).trimEnd();
}
