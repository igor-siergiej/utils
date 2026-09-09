import type { KanbanBoard, KanbanItem } from './types';
import { RETRY_GATES } from './types';

export function serializeKanbanBoard(board: KanbanBoard): string {
    const lines: string[] = [`# ${board.title}`, ''];

    for (const column of board.columns) {
        lines.push(`## ${column.name}`, '');

        for (const item of column.items) {
            lines.push(`### ${item.title}`, '', ...serializeMeta(item), '');

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

function serializeMeta(item: KanbanItem): string[] {
    const bullets: string[] = [`- **id:** ${item.id}`];

    if (item.tags?.length) bullets.push(`- **tags:** ${item.tags.join(', ')}`);
    if (item.branch) bullets.push(`- **branch:** ${item.branch}`);
    if (item.pr !== undefined) bullets.push(`- **pr:** ${item.pr}`);
    if (item.mergedCommit) bullets.push(`- **merged_commit:** ${item.mergedCommit}`);
    if (item.revertPr !== undefined) bullets.push(`- **revert_pr:** ${item.revertPr}`);

    const retries = RETRY_GATES.map((gate) => `${gate} ${item.retries[gate]}`).join(', ');
    bullets.push(`- **retries:** ${retries}`);

    if (item.blockedReason) bullets.push(`- **blocked_reason:** ${item.blockedReason}`);
    if (item.completedAt) bullets.push(`- **completed_at:** ${item.completedAt}`);

    return bullets;
}
