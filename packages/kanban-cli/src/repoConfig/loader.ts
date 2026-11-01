import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { errorMessage } from '../errorMessage';
import type { JsonValue } from '../json';
import { RepoConfigError } from './errors';
import { CONFIG_FILENAME, DEFAULT_RETRY_POLICY, type FactoryConfig, type RepoConfig } from './types';

export type LoadRepoConfigResult = { configFound: false } | { configFound: true; config: RepoConfig };

export function loadRepoConfig(repoPath: string): LoadRepoConfigResult {
    const configPath = join(repoPath, CONFIG_FILENAME);

    if (!existsSync(configPath)) {
        return { configFound: false };
    }

    let raw: JsonValue;

    try {
        raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (cause) {
        throw new RepoConfigError(`${CONFIG_FILENAME} is not valid JSON: ${errorMessage(cause)}`);
    }

    return { configFound: true, config: validateRepoConfig(raw) };
}

const nonBlankString = z.string().refine((value) => value.trim() !== '', 'must be a non-empty string');

const devSchema = z.object({
    startCommand: nonBlankString,
    healthCheckUrl: nonBlankString,
    healthCheckTimeoutMs: z.number().default(60000),
    healthCheckIntervalMs: z.number().default(2000),
    teardownCommand: nonBlankString.optional(),
});

const e2eSchema = z
    .object({
        testCommand: nonBlankString,
        smokeGrep: nonBlankString,
        configPath: nonBlankString.default('playwright.config.ts'),
        reportPath: nonBlankString.optional(),
    })
    .transform((e2e) => ({ framework: 'playwright' as const, ...e2e }));

const ciSchema = z.object({
    workflowNames: z.array(z.string()),
    checkNamesRequired: z.array(z.string()).default([]),
});

const deploySchema = z.object({
    workflowName: nonBlankString,
    timeoutMs: z.number().default(900000),
    pollIntervalMs: z.number().default(15000),
});

const environmentsSchema = z
    .record(z.string(), z.object({ baseUrl: nonBlankString }))
    .refine((environments) => Object.keys(environments).length > 0, 'must define at least one environment');

const retryPolicySchema = z
    .object({
        implement: z.number().default(DEFAULT_RETRY_POLICY.implement),
        e2e_local: z.number().default(DEFAULT_RETRY_POLICY.e2e_local),
        ci: z.number().default(DEFAULT_RETRY_POLICY.ci),
        deploy: z.number().default(DEFAULT_RETRY_POLICY.deploy),
        e2e_live: z.number().default(DEFAULT_RETRY_POLICY.e2e_live),
    })
    .prefault({});

const githubSchema = z
    .object({
        defaultBranch: nonBlankString.default('main'),
        mergeMethod: z.enum(['squash', 'merge', 'rebase']).default('squash'),
    })
    .prefault({});

const factorySchema = z
    .object({ rateLimitFallbackMinutes: z.number().optional() })
    .optional()
    .transform((factory): FactoryConfig | undefined =>
        factory?.rateLimitFallbackMinutes === undefined
            ? undefined
            : { rateLimitFallbackMinutes: factory.rateLimitFallbackMinutes }
    );

const repoConfigSchema = z
    .object({
        repoName: nonBlankString,
        dev: devSchema,
        e2e: e2eSchema,
        ci: ciSchema,
        deploy: deploySchema,
        environments: environmentsSchema,
        targetEnvironment: nonBlankString,
        retryPolicy: retryPolicySchema,
        github: githubSchema,
        factory: factorySchema,
    })
    .superRefine((config, ctx) => {
        if (!Object.hasOwn(config.environments, config.targetEnvironment)) {
            ctx.addIssue({
                code: 'custom',
                path: ['targetEnvironment'],
                message: `targetEnvironment '${config.targetEnvironment}' is not defined in 'environments'`,
            });
        }
    }) satisfies z.ZodType<RepoConfig>;

export function validateRepoConfig(raw: JsonValue): RepoConfig {
    const result = repoConfigSchema.safeParse(raw);

    if (result.success) return result.data;

    const [issue] = result.error.issues;
    const field = issue.path.length > 0 ? issue.path.join('.') : '<root>';

    throw new RepoConfigError(`'${field}': ${issue.message}`);
}
