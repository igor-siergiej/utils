import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planImport } from '../jottImport/plan';
import { type JottRun, jottCli, summarize, writeToJott } from '../jottImport/write';

/** Temporary: imports every board in `dir` into jott once. Deleted after the migration has run. */
export function migrateToJott(dir: string, opts: { dryRun: boolean; run?: JottRun }) {
    const files = readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
    const plan = planImport(files);
    const summary = summarize(plan);
    if (opts.dryRun) return { ok: true as const, dryRun: true, ...summary };
    return { ok: true as const, dryRun: false, ...summary, ...writeToJott(plan, opts.run ?? jottCli()) };
}
