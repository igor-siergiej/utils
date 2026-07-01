import type { RetryCounters } from '../kanban/types';

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
}

export const CONFIG_FILENAME = '.kanban-cli.json';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    implement: 3,
    e2e_local: 3,
    ci: 3,
    deploy: 2,
    e2e_live: 1,
};
