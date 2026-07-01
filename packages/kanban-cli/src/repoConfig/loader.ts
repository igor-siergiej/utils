import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETRY_GATES } from '../kanban/types';
import { RepoConfigError } from './errors';
import type {
    CiConfig,
    DeployConfig,
    DevConfig,
    E2eConfig,
    EnvironmentConfig,
    GithubConfig,
    RepoConfig,
} from './types';
import { CONFIG_FILENAME, DEFAULT_RETRY_POLICY } from './types';

export type LoadRepoConfigResult = { configFound: false } | { configFound: true; config: RepoConfig };

export function loadRepoConfig(repoPath: string): LoadRepoConfigResult {
    const configPath = join(repoPath, CONFIG_FILENAME);

    if (!existsSync(configPath)) {
        return { configFound: false };
    }

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (cause) {
        throw new RepoConfigError(`${CONFIG_FILENAME} is not valid JSON: ${(cause as Error).message}`);
    }

    return { configFound: true, config: validateRepoConfig(raw) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw new RepoConfigError(`'${field}' is required and must be an object`);
    return value;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new RepoConfigError(`'${field}' is required and must be a non-empty string`);
    }
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function optionalNumber(value: unknown, field: string, fallback: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new RepoConfigError(`'${field}' must be a number`);
    }
    return value;
}

function requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        throw new RepoConfigError(`'${field}' must be an array of strings`);
    }
    return value;
}

function validateDev(raw: unknown): DevConfig {
    const obj = requireObject(raw, 'dev');
    return {
        startCommand: requireString(obj.startCommand, 'dev.startCommand'),
        healthCheckUrl: requireString(obj.healthCheckUrl, 'dev.healthCheckUrl'),
        healthCheckTimeoutMs: optionalNumber(obj.healthCheckTimeoutMs, 'dev.healthCheckTimeoutMs', 60000),
        healthCheckIntervalMs: optionalNumber(obj.healthCheckIntervalMs, 'dev.healthCheckIntervalMs', 2000),
        teardownCommand: optionalString(obj.teardownCommand, 'dev.teardownCommand'),
    };
}

function validateE2e(raw: unknown): E2eConfig {
    const obj = requireObject(raw, 'e2e');
    return {
        framework: 'playwright',
        testCommand: requireString(obj.testCommand, 'e2e.testCommand'),
        smokeGrep: requireString(obj.smokeGrep, 'e2e.smokeGrep'),
        configPath: optionalString(obj.configPath, 'e2e.configPath') ?? 'playwright.config.ts',
        reportPath: optionalString(obj.reportPath, 'e2e.reportPath'),
    };
}

function validateCi(raw: unknown): CiConfig {
    const obj = requireObject(raw, 'ci');
    return {
        workflowNames: requireStringArray(obj.workflowNames, 'ci.workflowNames'),
        checkNamesRequired:
            obj.checkNamesRequired === undefined
                ? []
                : requireStringArray(obj.checkNamesRequired, 'ci.checkNamesRequired'),
    };
}

function validateDeploy(raw: unknown): DeployConfig {
    const obj = requireObject(raw, 'deploy');
    return {
        workflowName: requireString(obj.workflowName, 'deploy.workflowName'),
        timeoutMs: optionalNumber(obj.timeoutMs, 'deploy.timeoutMs', 900000),
        pollIntervalMs: optionalNumber(obj.pollIntervalMs, 'deploy.pollIntervalMs', 15000),
    };
}

function validateEnvironments(raw: unknown): Record<string, EnvironmentConfig> {
    const obj = requireObject(raw, 'environments');
    const environments: Record<string, EnvironmentConfig> = {};

    for (const [name, value] of Object.entries(obj)) {
        const envObj = requireObject(value, `environments.${name}`);
        environments[name] = { baseUrl: requireString(envObj.baseUrl, `environments.${name}.baseUrl`) };
    }

    if (Object.keys(environments).length === 0) {
        throw new RepoConfigError("'environments' must define at least one environment");
    }

    return environments;
}

function validateRetryPolicy(raw: unknown): RepoConfig['retryPolicy'] {
    if (raw === undefined) return { ...DEFAULT_RETRY_POLICY };

    const obj = requireObject(raw, 'retryPolicy');
    const policy = { ...DEFAULT_RETRY_POLICY };

    for (const gate of RETRY_GATES) {
        if (obj[gate] !== undefined) {
            policy[gate] = optionalNumber(obj[gate], `retryPolicy.${gate}`, policy[gate]);
        }
    }

    return policy;
}

function validateGithub(raw: unknown): GithubConfig {
    if (raw === undefined) return { defaultBranch: 'main', mergeMethod: 'squash' };

    const obj = requireObject(raw, 'github');
    const mergeMethod = optionalString(obj.mergeMethod, 'github.mergeMethod') ?? 'squash';

    if (mergeMethod !== 'squash' && mergeMethod !== 'merge' && mergeMethod !== 'rebase') {
        throw new RepoConfigError("'github.mergeMethod' must be one of 'squash' | 'merge' | 'rebase'");
    }

    return {
        defaultBranch: optionalString(obj.defaultBranch, 'github.defaultBranch') ?? 'main',
        mergeMethod,
    };
}

export function validateRepoConfig(raw: unknown): RepoConfig {
    const obj = requireObject(raw, '<root>');
    const targetEnvironment = requireString(obj.targetEnvironment, 'targetEnvironment');
    const environments = validateEnvironments(obj.environments);

    if (!(targetEnvironment in environments)) {
        throw new RepoConfigError(`targetEnvironment '${targetEnvironment}' is not defined in 'environments'`);
    }

    return {
        repoName: requireString(obj.repoName, 'repoName'),
        dev: validateDev(obj.dev),
        e2e: validateE2e(obj.e2e),
        ci: validateCi(obj.ci),
        deploy: validateDeploy(obj.deploy),
        environments,
        targetEnvironment,
        retryPolicy: validateRetryPolicy(obj.retryPolicy),
        github: validateGithub(obj.github),
    };
}
