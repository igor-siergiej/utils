import { spawnSync } from 'node:child_process';
import type { ImportPlan, JottStatus } from './plan';

/** Runs one jott command; returns its parsed JSON, throws on a non-zero exit or `ok: false`. */
export type JottRun = (args: string[], stdin?: string) => unknown;

export function jottCli(bin: string = process.env.JOTT_BIN ?? 'jott'): JottRun {
    return (args, stdin) => {
        const r = spawnSync(bin, args, { input: stdin ?? '', encoding: 'utf8' });
        if (r.error) throw r.error;
        let parsed: { ok?: boolean; error?: string };
        try {
            parsed = JSON.parse(r.stdout);
        } catch {
            throw new Error(`jott ${args.join(' ')}: ${r.stderr.trim() || r.stdout.trim()}`);
        }
        if (r.status !== 0 || parsed.ok === false) {
            throw new Error(`jott ${args.join(' ')}: ${parsed.error ?? r.stderr.trim()}`);
        }
        return parsed;
    };
}

export function summarize(plan: ImportPlan) {
    const files: Record<string, Partial<Record<JottStatus, number>>> = {};
    for (const t of plan.tasks) {
        files[t.source] ??= {};
        const counts = files[t.source];
        counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return { total: plan.tasks.length, files, skipped: plan.skipped };
}

/** One-shot: refuses if any jott task already carries `meta.slug`. Tasks are added in plan order. */
export function writeToJott(plan: ImportPlan, run: JottRun): { created: number } {
    const listed = run(['task', 'list', '--all', '--json']) as { tasks: { meta?: Record<string, unknown> }[] };
    if (listed.tasks.some((t) => t.meta && 'slug' in t.meta)) {
        throw new Error('jott already has imported tasks (meta.slug is set); the import runs once');
    }

    for (const t of plan.tasks) {
        const args = ['task', 'add', '--status', t.status, '--body', '-'];
        if (t.project) args.push('--project', t.project);
        for (const tag of t.tags) args.push('--tag', tag);
        args.push('--json', '--', t.title);
        const added = run(args, t.body) as { task: { number: number } };

        const meta = Object.entries(t.meta);
        if (meta.length > 0) {
            run([
                'task',
                'set',
                String(added.task.number),
                ...meta.flatMap(([k, v]) => ['--meta', `${k}=${JSON.stringify(v)}`]),
                '--json',
            ]);
        }
    }
    return { created: plan.tasks.length };
}
