#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { ciWait } from './commands/ciWait';
import { cloneRepo } from './commands/cloneRepo';
import { deployWait } from './commands/deployWait';
import { dispatch } from './commands/dispatch';
import { e2eBootstrap } from './commands/e2eBootstrap';
import { e2eLiveRun } from './commands/e2eLiveRun';
import { e2eLocalRun } from './commands/e2eLocalRun';
import { initConfig } from './commands/initConfig';
import { installSkill } from './commands/installSkill';
import { prCreate } from './commands/prCreate';
import { prMerge } from './commands/prMerge';
import { prRevert } from './commands/prRevert';
import { prStatus } from './commands/prStatus';
import { recordUsage } from './commands/recordUsage';
import { repoCheck } from './commands/repoCheck';
import { ship } from './commands/ship';
import { usageCheck } from './commands/usageCheck';
import { resolveRepoPath } from './repoRegistry/resolveRepo';
import { ensureWorktree, removeWorktree } from './worktree/worktree';

function printSuccess(data: unknown): void {
    process.stdout.write(`${JSON.stringify(data)}\n`);
}

function printError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
}

const USAGE =
    'Usage: kanban-cli <command> ...\n' +
    'Commands: resolve-repo <project>, clone <project> [--url <repoUrl>],\n' +
    '          repo-check <repoPath>, init-config <repoPath>, install-skill --target <dir> [--skill <name>],\n' +
    '          e2e <local|live|bootstrap> <repoPath>, pr <create|status|merge|revert>,\n' +
    '          ci wait <repoPath> <prNumber>, deploy wait <repoPath>, ship <repoPath>,\n' +
    '          record-usage (reads statusline JSON from stdin), usage-check,\n' +
    '          worktree <create|remove> <project> <n>, dispatch [--once]\n' +
    'Task state lives in jott: `jott task … --json`.';

async function runE2e(rest: string[]): Promise<unknown> {
    const [sub, ...subRest] = rest;

    if (sub === 'local') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: { grep: { type: 'string' } },
            allowPositionals: true,
        });
        return e2eLocalRun(positionals[0], { grep: values.grep });
    }

    if (sub === 'live') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: { url: { type: 'string' }, grep: { type: 'string' } },
            allowPositionals: true,
        });
        if (!values.url) throw new Error('--url is required');
        return e2eLiveRun(positionals[0], values.url, { grep: values.grep });
    }

    if (sub === 'bootstrap') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: { force: { type: 'boolean' } },
            allowPositionals: true,
        });
        return e2eBootstrap(positionals[0], { force: values.force });
    }

    throw new Error(`Unknown e2e subcommand '${sub}'. Expected local, live or bootstrap.`);
}

async function runPr(rest: string[]): Promise<unknown> {
    const [sub, ...subRest] = rest;

    if (sub === 'create') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: {
                title: { type: 'string' },
                body: { type: 'string' },
                base: { type: 'string' },
                head: { type: 'string' },
            },
            allowPositionals: true,
        });
        if (!values.title || !values.body || !values.base || !values.head) {
            throw new Error('--title, --body, --base and --head are required');
        }
        return prCreate(positionals[0], {
            title: values.title,
            body: values.body,
            base: values.base,
            head: values.head,
        });
    }

    if (sub === 'status') {
        const { positionals } = parseArgs({ args: subRest, options: {}, allowPositionals: true });
        return prStatus(positionals[0], Number(positionals[1]));
    }

    if (sub === 'merge') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: { method: { type: 'string' } },
            allowPositionals: true,
        });
        return prMerge(
            positionals[0],
            Number(positionals[1]),
            (values.method as 'squash' | 'merge' | 'rebase' | undefined) ?? 'squash'
        );
    }

    if (sub === 'revert') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: {
                commit: { type: 'string' },
                base: { type: 'string' },
                title: { type: 'string' },
                'pr-number': { type: 'string' },
                summary: { type: 'string' },
            },
            allowPositionals: true,
        });
        if (!values.commit || !values.base || !values.title || !values.summary) {
            throw new Error('--commit, --base, --title and --summary are required');
        }
        return prRevert(positionals[0], {
            commitSha: values.commit,
            base: values.base,
            originalTitle: values.title,
            originalPrNumber: values['pr-number'] ? Number(values['pr-number']) : undefined,
            failureSummary: values.summary,
        });
    }

    throw new Error(`Unknown pr subcommand '${sub}'. Expected create, status, merge or revert.`);
}

async function runCi(rest: string[]): Promise<unknown> {
    const [sub, ...subRest] = rest;

    if (sub === 'wait') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: {
                timeout: { type: 'string' },
                interval: { type: 'string' },
                required: { type: 'string', multiple: true },
            },
            allowPositionals: true,
        });
        return ciWait(positionals[0], Number(positionals[1]), {
            timeoutMs: values.timeout ? Number(values.timeout) : undefined,
            intervalMs: values.interval ? Number(values.interval) : undefined,
            requiredNames: values.required,
        });
    }

    throw new Error(`Unknown ci subcommand '${sub}'. Expected wait.`);
}

async function runDeploy(rest: string[]): Promise<unknown> {
    const [sub, ...subRest] = rest;

    if (sub === 'wait') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: {
                workflow: { type: 'string' },
                commit: { type: 'string' },
                timeout: { type: 'string' },
                interval: { type: 'string' },
            },
            allowPositionals: true,
        });
        if (!values.workflow || !values.commit) throw new Error('--workflow and --commit are required');
        return deployWait(positionals[0], {
            workflow: values.workflow,
            commit: values.commit,
            timeoutMs: values.timeout ? Number(values.timeout) : undefined,
            intervalMs: values.interval ? Number(values.interval) : undefined,
        });
    }

    throw new Error(`Unknown deploy subcommand '${sub}'. Expected wait.`);
}

async function main(): Promise<void> {
    const [command, ...rest] = process.argv.slice(2);

    switch (command) {
        case 'resolve-repo': {
            const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
            if (!positionals[0]) throw new Error('Usage: kanban-cli resolve-repo <project>');
            printSuccess({ ok: true, repo: resolveRepoPath(positionals[0]) });
            return;
        }
        case 'clone': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: { url: { type: 'string' }, root: { type: 'string' } },
                allowPositionals: true,
            });
            if (!positionals[0]) throw new Error('Usage: kanban-cli clone <project> [--url <repoUrl>] [--root <dir>]');
            printSuccess(await cloneRepo(positionals[0], values.url, { root: values.root }));
            return;
        }
        case 'repo-check': {
            const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
            printSuccess(repoCheck(positionals[0]));
            return;
        }
        case 'init-config': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: {
                    'repo-name': { type: 'string' },
                    'base-url': { type: 'string' },
                    environment: { type: 'string' },
                },
                allowPositionals: true,
            });
            if (!positionals[0]) {
                throw new Error(
                    'Usage: kanban-cli init-config <repoPath> [--repo-name <n>] [--base-url <url>] [--environment <name>]'
                );
            }
            printSuccess(
                initConfig(positionals[0], {
                    repoName: values['repo-name'],
                    baseUrl: values['base-url'],
                    environment: values.environment,
                })
            );
            return;
        }
        case 'install-skill': {
            const { values } = parseArgs({
                args: rest,
                options: {
                    target: { type: 'string' },
                    symlink: { type: 'boolean' },
                    skill: { type: 'string' },
                },
            });
            if (!values.target) throw new Error('--target is required');
            printSuccess(
                installSkill(values.target, {
                    mode: values.symlink ? 'symlink' : 'copy',
                    skill: values.skill,
                })
            );
            return;
        }
        case 'e2e':
            printSuccess(await runE2e(rest));
            return;
        case 'pr':
            printSuccess(await runPr(rest));
            return;
        case 'ci':
            printSuccess(await runCi(rest));
            return;
        case 'deploy':
            printSuccess(await runDeploy(rest));
            return;
        case 'ship': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: {
                    title: { type: 'string' },
                    body: { type: 'string' },
                    head: { type: 'string' },
                    'ci-timeout': { type: 'string' },
                },
                allowPositionals: true,
            });
            if (!positionals[0]) {
                throw new Error('Usage: kanban-cli ship <repoPath> [--title <t> --body <b>] [--head <branch>]');
            }
            printSuccess(
                await ship(positionals[0], {
                    title: values.title,
                    body: values.body,
                    head: values.head,
                    ciTimeoutMs: values['ci-timeout'] ? Number(values['ci-timeout']) : undefined,
                })
            );
            return;
        }
        case 'record-usage': {
            const stdinText = await Bun.stdin.text();
            printSuccess(recordUsage(stdinText));
            return;
        }
        case 'usage-check': {
            const { values } = parseArgs({
                args: rest,
                options: { threshold: { type: 'string' }, 'max-staleness-ms': { type: 'string' } },
            });
            printSuccess(
                usageCheck({
                    thresholdPct: values.threshold ? Number(values.threshold) : undefined,
                    maxStalenessMs: values['max-staleness-ms'] ? Number(values['max-staleness-ms']) : undefined,
                })
            );
            return;
        }
        case 'worktree': {
            const [sub, project, n] = rest;
            if ((sub !== 'create' && sub !== 'remove') || !project || !Number.isInteger(Number(n))) {
                throw new Error('Usage: kanban-cli worktree <create|remove> <project> <n>');
            }
            const repo = resolveRepoPath(project);
            if (sub === 'create') {
                printSuccess({ ok: true, worktree: await ensureWorktree(repo, project, Number(n)) });
            } else {
                await removeWorktree(repo, project, Number(n));
                printSuccess({ ok: true });
            }
            return;
        }
        case 'dispatch': {
            const { values } = parseArgs({ args: rest, options: { once: { type: 'boolean' } } });
            const result = await dispatch({ once: values.once });
            printSuccess({ ok: true, result });
            return;
        }
        case undefined:
        case '--help':
        case '-h':
            process.stdout.write(`${USAGE}\n`);
            return;
        default:
            throw new Error(`Unknown command '${command}'.\n${USAGE}`);
    }
}

main().catch((error) => {
    printError(error);
    process.exit(1);
});
