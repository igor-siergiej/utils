import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { errorMessage } from '../errorMessage';
import { type JsonObject, type JsonValue, jsonObject, jsonString, tryParseJson } from '../json';
import { RepoConfigError } from './errors';
import { validateRepoConfig } from './loader';
import { CONFIG_FILENAME } from './types';

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/** The package.json fields the scaffold reads; a field of the wrong type counts as absent. */
const packageJsonSchema = z.object({
    name: lenient(z.string()),
    packageManager: lenient(z.string()),
    homepage: lenient(z.string()),
    scripts: z.record(z.string(), z.json()).catch({}),
    dependencies: z.record(z.string(), z.json()).catch({}),
    devDependencies: z.record(z.string(), z.json()).catch({}),
});

type PackageJson = z.infer<typeof packageJsonSchema>;

const workflowSchema = z.object({
    name: lenient(z.string()),
    // The event names that trigger the workflow, whichever of the three YAML spellings it uses.
    on: z
        .union([
            z.string().transform((event) => [event]),
            z.array(z.any()),
            z.record(z.string(), z.any()).transform((events) => Object.keys(events)),
        ])
        .catch([]),
});

export interface ScaffoldOptions {
    repoName?: string;
    baseUrl?: string;
    environment?: string;
}

export interface ScaffoldResult {
    path: string;
    written: boolean;
    /** Field paths this run filled in; everything else in the file was already there. */
    inferred: string[];
    /** Required field paths still absent — nothing in the repo said what they should be. */
    missing: string[];
    valid: boolean;
    validationError?: string;
}

const REQUIRED_FIELDS = [
    'repoName',
    'dev.startCommand',
    'dev.healthCheckUrl',
    'e2e.testCommand',
    'e2e.smokeGrep',
    'ci.workflowNames',
    'deploy.workflowName',
    'environments',
    'targetEnvironment',
];

const PLAYWRIGHT_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];

function readJson(path: string): JsonObject | undefined {
    if (!existsSync(path)) return undefined;

    try {
        return jsonObject(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
        return undefined;
    }
}

function readPackageJson(path: string): PackageJson | undefined {
    if (!existsSync(path)) return undefined;

    return packageJsonSchema.safeParse(tryParseJson(readFileSync(path, 'utf8'))).data;
}

function detectPackageManager(repoPath: string, pkg: PackageJson | undefined): string {
    const declared = pkg?.packageManager?.split('@')[0];

    if (declared) return declared;

    if (existsSync(join(repoPath, 'bun.lock')) || existsSync(join(repoPath, 'bun.lockb'))) return 'bun';

    if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';

    if (existsSync(join(repoPath, 'yarn.lock'))) return 'yarn';

    return 'npm';
}

const EXEC = new Map([
    ['bun', 'bunx'],
    ['pnpm', 'pnpm exec'],
    ['yarn', 'yarn'],
    ['npm', 'npx'],
]);

interface Workflow {
    file: string;
    name: string;
    onPullRequest: boolean;
}

function readWorkflows(repoPath: string): Workflow[] {
    const dir = join(repoPath, '.github', 'workflows');

    if (!existsSync(dir)) return [];

    return readdirSync(dir)
        .filter((file) => /\.ya?ml$/.test(file))
        .sort()
        .flatMap((file) => {
            let parsed;

            try {
                parsed = parseYaml(readFileSync(join(dir, file), 'utf8'));
            } catch {
                return [];
            }

            const doc = workflowSchema.safeParse(parsed).data;

            if (!doc) return [];

            return [{ file, name: doc.name ?? file, onPullRequest: doc.on.includes('pull_request') }];
        });
}

function inferConfig(repoPath: string, options: ScaffoldOptions): JsonObject {
    const pkg = readPackageJson(join(repoPath, 'package.json'));
    const scripts = pkg?.scripts ?? {};
    const hasScript = (name: string) => jsonString(scripts[name]) !== undefined;
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    const pm = detectPackageManager(repoPath, pkg);

    const config: JsonObject = {};

    const pkgName = pkg?.name?.replace(/^@[^/]+\//, '');
    config.repoName = options.repoName ?? pkgName ?? basename(repoPath);

    const devScript = ['dev', 'start'].find(hasScript);
    const port = 'vite' in deps ? 5173 : 3000;
    const dev: JsonObject = {};

    if (devScript) dev.startCommand = `${pm} run ${devScript}`;
    dev.healthCheckUrl = `http://localhost:${port}`;
    config.dev = dev;

    const e2eScript = ['test:e2e', 'e2e'].find(hasScript);
    const playwrightConfig = PLAYWRIGHT_CONFIGS.find((file) => existsSync(join(repoPath, file)));

    const e2e: JsonObject = {
        framework: 'playwright',
        testCommand: e2eScript ? `${pm} run ${e2eScript}` : `${EXEC.get(pm) ?? 'npx'} playwright test`,
        smokeGrep: '@smoke',
    };

    if (playwrightConfig) e2e.configPath = playwrightConfig;
    config.e2e = e2e;

    const workflows = readWorkflows(repoPath);
    const isDeploy = (w: Workflow) => /deploy|^cd$/i.test(w.name) || /deploy/i.test(w.file);
    const ciWorkflows = workflows.filter((w) => w.onPullRequest && !isDeploy(w));

    if (ciWorkflows.length > 0) config.ci = { workflowNames: ciWorkflows.map((w) => w.name) };

    const deployWorkflow = workflows.find(isDeploy);

    if (deployWorkflow) config.deploy = { workflowName: deployWorkflow.name };

    const homepage = pkg?.homepage && /^https?:\/\//.test(pkg.homepage) ? pkg.homepage : undefined;
    const baseUrl = options.baseUrl ?? homepage;

    if (baseUrl) {
        const environment = options.environment ?? 'production';
        config.environments = { [environment]: { baseUrl } };
        config.targetEnvironment = environment;
    }

    return config;
}

/** Copies every leaf of `source` that `target` lacks, recording each copied path. */
function fillMissing(target: JsonObject, source: JsonObject, prefix: string, filled: string[]): void {
    for (const [key, value] of Object.entries(source)) {
        const path = prefix ? `${prefix}.${key}` : key;
        const existing = jsonObject(target[key]);
        const incoming = jsonObject(value);

        if (target[key] === undefined) {
            target[key] = value;
            filled.push(path);
        } else if (existing && incoming && key !== 'environments') {
            fillMissing(existing, incoming, path, filled);
            target[key] = existing;
        }
    }
}

function hasPath(config: JsonObject, path: string): boolean {
    let current: JsonValue | undefined = config;

    for (const part of path.split('.')) {
        const object = jsonObject(current);

        if (!object) return false;
        current = object[part];
    }

    return current !== undefined;
}

/**
 * Writes `.kanban-cli.json`, filling every field it can infer from the repo
 * (package.json scripts, lockfile, Playwright config, GitHub workflow files).
 * Fields already in an existing file always win, so re-running is safe.
 */
export function scaffoldRepoConfig(repoPath: string, options: ScaffoldOptions = {}): ScaffoldResult {
    const path = join(repoPath, CONFIG_FILENAME);

    let config: JsonObject = {};

    if (existsSync(path)) {
        const existing = readJson(path);

        if (!existing)
            throw new RepoConfigError(`${CONFIG_FILENAME} exists but is not a JSON object; fix or delete it first`);
        config = existing;
    }

    const inferred: string[] = [];
    fillMissing(config, inferConfig(repoPath, options), '', inferred);

    const written = inferred.length > 0;

    if (written) writeFileSync(path, `${JSON.stringify(config, null, 4)}\n`);

    const missing = REQUIRED_FIELDS.filter((field) => !hasPath(config, field));

    let validationError: string | undefined;

    try {
        validateRepoConfig(config);
    } catch (cause) {
        validationError = errorMessage(cause);
    }

    return { path, written, inferred, missing, valid: validationError === undefined, validationError };
}
