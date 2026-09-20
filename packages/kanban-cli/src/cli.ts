#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { ciWait } from './commands/ciWait';
import { deployWait } from './commands/deployWait';
import { e2eBootstrap } from './commands/e2eBootstrap';
import { e2eLiveRun } from './commands/e2eLiveRun';
import { e2eLocalRun } from './commands/e2eLocalRun';
import { inboxDrop } from './commands/inboxDrop';
import { inboxList } from './commands/inboxList';
import { inboxPromote } from './commands/inboxPromote';
import { installSkill } from './commands/installSkill';
import { kanbanColumns } from './commands/kanbanColumns';
import { kanbanMigrate } from './commands/kanbanMigrate';
import { kanbanMove } from './commands/kanbanMove';
import { kanbanNext } from './commands/kanbanNext';
import { kanbanShow } from './commands/kanbanShow';
import { kanbanUpdate } from './commands/kanbanUpdate';
import { prCreate } from './commands/prCreate';
import { prMerge } from './commands/prMerge';
import { prRevert } from './commands/prRevert';
import { prStatus } from './commands/prStatus';
import { recordUsage } from './commands/recordUsage';
import { repoCheck } from './commands/repoCheck';
import { usageCheck } from './commands/usageCheck';
import type { RetryGate } from './kanban/types';

const DEFAULT_BOARD_PATH = process.env.KANBAN_CLI_BOARD ?? './KANBAN.md';

function printSuccess(data: unknown): void {
    process.stdout.write(`${JSON.stringify(data)}\n`);
}

function printError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
}

const USAGE =
    'Usage: kanban-cli <command> ...\n' +
    'Commands: next, show <id>, move <id> <column>, update <id>, columns, migrate <board>,\n' +
    '          repo-check <repoPath>, install-skill --target <dir>,\n' +
    '          e2e <local|live|bootstrap> <repoPath>, pr <create|status|merge|revert>,\n' +
    '          ci wait <repoPath> <prNumber>, deploy wait <repoPath>,\n' +
    '          inbox <list|promote|drop>,\n' +
    '          record-usage (reads statusline JSON from stdin), usage-check';

const INBOX_USAGE =
    'Usage: kanban-cli inbox list [--kanban <path>]\n' +
    '       kanban-cli inbox promote <index> --id <id> --title <t> [--tags a,b]\n' +
    '                                [--body <text> | --body-file <path>] [--column <name>] [--kanban <path>]\n' +
    '       kanban-cli inbox drop <index> [--reason <text>] [--kanban <path>]';

function captureIndex(raw: string | undefined): number {
    const index = Number(raw);
    if (!raw || !Number.isInteger(index) || index < 1) {
        throw new Error(`a 1-based capture index is required (from 'kanban-cli inbox list')\n${INBOX_USAGE}`);
    }
    return index;
}

function runInbox(rest: string[]): unknown {
    const [sub, ...subRest] = rest;

    if (sub === 'list') {
        const { values } = parseArgs({ args: subRest, options: { kanban: { type: 'string' } } });
        return inboxList(values.kanban ?? DEFAULT_BOARD_PATH);
    }

    if (sub === 'promote') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: {
                kanban: { type: 'string' },
                id: { type: 'string' },
                title: { type: 'string' },
                tags: { type: 'string' },
                body: { type: 'string' },
                'body-file': { type: 'string' },
                column: { type: 'string' },
            },
            allowPositionals: true,
        });

        if (!values.id || !values.title) {
            throw new Error(`--id and --title are both required\n${INBOX_USAGE}`);
        }

        return inboxPromote(
            values.kanban ?? DEFAULT_BOARD_PATH,
            captureIndex(positionals[0]),
            {
                id: values.id,
                title: values.title,
                tags: values.tags
                    ?.split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
            },
            { body: values.body, bodyFile: values['body-file'], column: values.column }
        );
    }

    if (sub === 'drop') {
        const { values, positionals } = parseArgs({
            args: subRest,
            options: { kanban: { type: 'string' }, reason: { type: 'string' } },
            allowPositionals: true,
        });
        return inboxDrop(values.kanban ?? DEFAULT_BOARD_PATH, captureIndex(positionals[0]), values.reason);
    }

    throw new Error(`Unknown inbox subcommand '${sub}'. Expected list, promote or drop.\n${INBOX_USAGE}`);
}

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
        case 'next': {
            const { values } = parseArgs({ args: rest, options: { kanban: { type: 'string' } } });
            printSuccess(kanbanNext(values.kanban ?? DEFAULT_BOARD_PATH));
            return;
        }
        case 'show': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: { kanban: { type: 'string' } },
                allowPositionals: true,
            });
            printSuccess(kanbanShow(values.kanban ?? DEFAULT_BOARD_PATH, positionals[0]));
            return;
        }
        case 'move': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: { kanban: { type: 'string' }, note: { type: 'string' } },
                allowPositionals: true,
            });
            printSuccess(kanbanMove(values.kanban ?? DEFAULT_BOARD_PATH, positionals[0], positionals[1], values.note));
            return;
        }
        case 'update': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: {
                    kanban: { type: 'string' },
                    'set-branch': { type: 'string' },
                    'set-pr': { type: 'string' },
                    'set-merged-commit': { type: 'string' },
                    'set-revert-pr': { type: 'string' },
                    'inc-retry': { type: 'string' },
                    complete: { type: 'boolean' },
                },
                allowPositionals: true,
            });
            printSuccess(
                kanbanUpdate(values.kanban ?? DEFAULT_BOARD_PATH, positionals[0], {
                    setBranch: values['set-branch'],
                    setPr: values['set-pr'] !== undefined ? Number(values['set-pr']) : undefined,
                    setMergedCommit: values['set-merged-commit'],
                    setRevertPr: values['set-revert-pr'] !== undefined ? Number(values['set-revert-pr']) : undefined,
                    incRetry: values['inc-retry'] as RetryGate | undefined,
                    complete: values.complete,
                })
            );
            return;
        }
        case 'columns': {
            const { values } = parseArgs({ args: rest, options: { kanban: { type: 'string' } } });
            printSuccess(kanbanColumns(values.kanban ?? DEFAULT_BOARD_PATH));
            return;
        }
        case 'inbox': {
            printSuccess(runInbox(rest));
            return;
        }
        case 'migrate': {
            const { values, positionals } = parseArgs({
                args: rest,
                options: { project: { type: 'string' } },
                allowPositionals: true,
            });
            if (!positionals[0]) throw new Error('Usage: kanban-cli migrate <board> [--project <name>]');
            printSuccess(kanbanMigrate(positionals[0], { project: values.project }));
            return;
        }
        case 'repo-check': {
            const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
            printSuccess(repoCheck(positionals[0]));
            return;
        }
        case 'install-skill': {
            const { values } = parseArgs({
                args: rest,
                options: { target: { type: 'string' }, symlink: { type: 'boolean' } },
            });
            if (!values.target) throw new Error('--target is required');
            printSuccess(installSkill(values.target, { mode: values.symlink ? 'symlink' : 'copy' }));
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
