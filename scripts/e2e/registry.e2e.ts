/**
 * Live gate for `kanban-cli e2e live` (run through scripts/e2e.sh). utils deploys nothing:
 * its release is the CI/CD workflow's push-to-main run, where semantic-release commits the
 * new version to main and publish-packages.sh publishes it. These specs check that release
 * from the outside, against the registry at E2E_BASE_URL. They only read from it.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const registry = (process.env.E2E_BASE_URL ?? 'https://registry.npmjs.org').replace(/\/$/, '');
const waitMs = Number(process.env.E2E_PUBLISH_WAIT_S ?? 300) * 1000;
const pollMs = 10_000;

interface Manifest {
    name: string;
    version: string;
    private?: boolean;
}

function git(...args: string[]): string {
    const result = Bun.spawnSync(['git', ...args], { stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
}

/** The public packages as released: main carries semantic-release's version commit. */
function releasedPackages(): Manifest[] {
    git('fetch', '-q', 'origin', 'main');
    return git('ls-tree', '--name-only', 'origin/main', 'packages/')
        .split('\n')
        .map((dir) => JSON.parse(git('show', `origin/main:${dir}/package.json`)) as Manifest)
        .filter((manifest) => manifest.private !== true);
}

/** Retries `attempt` until it returns true or the publish wait runs out; the registry lags a publish briefly. */
async function eventually(attempt: () => Promise<boolean>): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    while (true) {
        if (await attempt()) return true;
        if (Date.now() + pollMs > deadline) return false;
        await Bun.sleep(pollMs);
    }
}

const packages = releasedPackages();

describe('released packages', () => {
    test('@smoke every public package on main is published at its version', async () => {
        const missing: string[] = [];
        for (const { name, version } of packages) {
            const url = `${registry}/${name.replace('/', '%2f')}/${version}`;
            const found = await eventually(async () => (await fetch(url)).ok);
            if (!found) missing.push(`${name}@${version}`);
        }

        expect(missing).toEqual([]);
    });

    test('@smoke the published kanban-cli installs and runs', async () => {
        const cli = packages.find((manifest) => manifest.name === '@imapps/kanban-cli');
        expect(cli).toBeDefined();
        const spec = `${cli?.name}@${cli?.version}`;
        const dir = mkdtempSync(join(tmpdir(), 'utils-e2e-'));

        try {
            await Bun.write(join(dir, 'package.json'), '{"name":"utils-e2e-live","private":true}');
            const installed = await eventually(async () => {
                const add = Bun.spawnSync(['bun', 'add', '--no-cache', `--registry=${registry}`, spec], { cwd: dir });
                return add.exitCode === 0;
            });
            expect(installed).toBe(true);

            const run = Bun.spawnSync([join(dir, 'node_modules', '.bin', 'kanban-cli'), '--help'], { cwd: dir });
            expect(run.exitCode).toBe(0);
            expect(run.stdout.toString()).toContain('Usage: kanban-cli');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
