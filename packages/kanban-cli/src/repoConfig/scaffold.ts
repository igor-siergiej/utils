import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '../typeGuards';
import { RepoConfigError } from './errors';
import { validateRepoConfig } from './loader';
import { CONFIG_FILENAME } from './types';

type Json = Record<string, unknown>;

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

function readJson(path: string): Json | undefined {
    if (!existsSync(path)) return undefined;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function detectPackageManager(repoPath: string, pkg: Json | undefined): string {
    const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : undefined;
    if (declared) return declared;
    if (existsSync(join(repoPath, 'bun.lock')) || existsSync(join(repoPath, 'bun.lockb'))) return 'bun';
    if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(repoPath, 'yarn.lock'))) return 'yarn';
    return 'npm';
}

const EXEC: Record<string, string> = { bun: 'bunx', pnpm: 'pnpm exec', yarn: 'yarn', npm: 'npx' };

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
            let doc: unknown;
            try {
                doc = parseYaml(readFileSync(join(dir, file), 'utf8'));
            } catch {
                return [];
            }
            if (!isRecord(doc)) return [];

            const on = doc.on;
            const triggers =
                typeof on === 'string' ? [on] : Array.isArray(on) ? on : isRecord(on) ? Object.keys(on) : [];
            return [
                {
                    file,
                    name: typeof doc.name === 'string' ? doc.name : file,
                    onPullRequest: triggers.includes('pull_request'),
                },
            ];
        });
}

function inferConfig(repoPath: string, options: ScaffoldOptions): Json {
    const pkg = readJson(join(repoPath, 'package.json'));
    const scripts = isRecord(pkg?.scripts) ? pkg.scripts : {};
    const deps = {
        ...(isRecord(pkg?.dependencies) ? pkg.dependencies : {}),
        ...(isRecord(pkg?.devDependencies) ? pkg.devDependencies : {}),
    };
    const pm = detectPackageManager(repoPath, pkg);

    const config: Json = {};

    const pkgName = typeof pkg?.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : undefined;
    config.repoName = options.repoName ?? pkgName ?? basename(repoPath);

    const devScript = ['dev', 'start'].find((name) => typeof scripts[name] === 'string');
    const port = 'vite' in deps ? 5173 : 3000;
    config.dev = {
        ...(devScript ? { startCommand: `${pm} run ${devScript}` } : {}),
        healthCheckUrl: `http://localhost:${port}`,
    };

    const e2eScript = ['test:e2e', 'e2e'].find((name) => typeof scripts[name] === 'string');
    const playwrightConfig = PLAYWRIGHT_CONFIGS.find((file) => existsSync(join(repoPath, file)));
    config.e2e = {
        framework: 'playwright',
        testCommand: e2eScript ? `${pm} run ${e2eScript}` : `${EXEC[pm] ?? 'npx'} playwright test`,
        smokeGrep: '@smoke',
        ...(playwrightConfig ? { configPath: playwrightConfig } : {}),
    };

    const workflows = readWorkflows(repoPath);
    const isDeploy = (w: Workflow) => /deploy|^cd$/i.test(w.name) || /deploy/i.test(w.file);
    const ciWorkflows = workflows.filter((w) => w.onPullRequest && !isDeploy(w));
    if (ciWorkflows.length > 0) config.ci = { workflowNames: ciWorkflows.map((w) => w.name) };

    const deployWorkflow = workflows.find(isDeploy);
    if (deployWorkflow) config.deploy = { workflowName: deployWorkflow.name };

    const homepage = typeof pkg?.homepage === 'string' && /^https?:\/\//.test(pkg.homepage) ? pkg.homepage : undefined;
    const baseUrl = options.baseUrl ?? homepage;
    if (baseUrl) {
        const environment = options.environment ?? 'production';
        config.environments = { [environment]: { baseUrl } };
        config.targetEnvironment = environment;
    }

    return config;
}

/** Copies every leaf of `source` that `target` lacks, recording each copied path. */
function fillMissing(target: Json, source: Json, prefix: string, filled: string[]): void {
    for (const [key, value] of Object.entries(source)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (target[key] === undefined) {
            target[key] = value;
            filled.push(path);
        } else if (isRecord(target[key]) && isRecord(value) && key !== 'environments') {
            fillMissing(target[key] as Json, value, path, filled);
        }
    }
}

function hasPath(config: Json, path: string): boolean {
    let current: unknown = config;
    for (const part of path.split('.')) {
        if (!isRecord(current)) return false;
        current = current[part];
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

    let config: Json = {};
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
        validationError = (cause as Error).message;
    }

    return { path, written, inferred, missing, valid: validationError === undefined, validationError };
}
