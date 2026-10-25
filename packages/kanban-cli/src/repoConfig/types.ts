export const RETRY_GATES = ['implement', 'e2e_local', 'ci', 'deploy', 'e2e_live'] as const;
export type RetryGate = (typeof RETRY_GATES)[number];

export type RetryCounters = Record<RetryGate, number>;

export interface DevConfig {
    startCommand: string;
    healthCheckUrl: string;
    healthCheckTimeoutMs: number;
    healthCheckIntervalMs: number;
    teardownCommand?: string;
}

export interface E2eConfig {
    framework: 'playwright';
    testCommand: string;
    smokeGrep: string;
    configPath: string;
    reportPath?: string;
}

export interface CiConfig {
    workflowNames: string[];
    checkNamesRequired: string[];
}

export interface DeployConfig {
    workflowName: string;
    timeoutMs: number;
    pollIntervalMs: number;
}

export interface EnvironmentConfig {
    baseUrl: string;
}

export type RetryPolicy = RetryCounters;

export interface GithubConfig {
    defaultBranch: string;
    mergeMethod: 'squash' | 'merge' | 'rebase';
}

export interface FactoryConfig {
    /** How long to pause a card when the provider gives no reset time. */
    rateLimitFallbackMinutes?: number;
}

export interface RepoConfig {
    repoName: string;
    dev: DevConfig;
    e2e: E2eConfig;
    ci: CiConfig;
    deploy: DeployConfig;
    environments: Record<string, EnvironmentConfig>;
    targetEnvironment: string;
    retryPolicy: RetryPolicy;
    github: GithubConfig;
    /** Factory dispatcher settings; the worker loop does not need them. */
    factory?: FactoryConfig;
}

export const CONFIG_FILENAME = '.kanban-cli.json';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    implement: 3,
    e2e_local: 3,
    ci: 3,
    deploy: 2,
    e2e_live: 1,
};
