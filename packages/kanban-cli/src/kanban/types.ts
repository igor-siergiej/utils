export const RETRY_GATES = ['implement', 'e2e_local', 'ci', 'deploy', 'e2e_live'] as const;
export type RetryGate = (typeof RETRY_GATES)[number];

export type RetryCounters = Record<RetryGate, number>;

export const REQUIRED_COLUMNS = ['Backlog', 'In Progress', 'Blocked', 'Done'] as const;

export interface KanbanItem {
    id: string;
    title: string;
    column: string;
    repo: string;
    body: string;
    retries: RetryCounters;
    tags?: string[];
    branch?: string;
    pr?: number;
    mergedCommit?: string;
    revertPr?: number;
    blockedReason?: string;
    completedAt?: string;
}

export interface KanbanColumn {
    name: string;
    items: KanbanItem[];
}

export interface KanbanBoard {
    title: string;
    columns: KanbanColumn[];
}
