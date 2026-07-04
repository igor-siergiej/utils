export interface PrInfo {
    number: number;
    url: string;
}

export interface PrStatus {
    number: number;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    mergeable: string;
    checksStatus: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NONE';
    reviewDecision: string | null;
    mergeCommitSha?: string;
}

export type GateStatus = 'success' | 'failure' | 'timeout';

export interface CheckRunSummary {
    name: string;
    status: string;
    conclusion: string | null;
}

export interface ChecksResult {
    status: GateStatus;
    checks: CheckRunSummary[];
}

export interface WorkflowRunSummary {
    status: GateStatus;
    runUrl?: string;
}
