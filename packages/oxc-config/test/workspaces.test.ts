import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturesRoot = join(repoDir, 'packages/oxc-config/.tmp-fixtures/workspaces');
const supportedPackages = ['@imapps/api-utils', '@imapps/dev-scripts', '@imapps/oxc-config', '@imapps/web-utils'];

mkdirSync(fixturesRoot, { recursive: true });

afterAll(() => {
    rmSync(fixturesRoot, { recursive: true, force: true });
});

describe('supported workspace inventory', () => {
    it('excludes the retired Biome package from the build graph while retaining every supported workspace', () => {
        const result = spawnSync('bun', ['run', 'build', '--dry=json'], {
            cwd: repoDir,
            encoding: 'utf8',
        });

        expect(result.status, result.stderr).toBe(0);

        const graph: { packages: string[] } = JSON.parse(result.stdout);

        expect(graph.packages.toSorted()).toEqual(supportedPackages);
    });

    it('stamps release versions for every supported workspace and no retired package', () => {
        const dir = mkdtempSync(join(fixturesRoot, 'release-'));
        const packagesDir = join(repoDir, 'packages');
        const workspaces = readdirSync(packagesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

        copyFileSync(join(repoDir, 'package.json'), join(dir, 'package.json'));

        for (const workspace of workspaces) {
            const destination = join(dir, 'packages', workspace.name);

            mkdirSync(destination, { recursive: true });
            copyFileSync(join(packagesDir, workspace.name, 'package.json'), join(destination, 'package.json'));
        }

        const version = '99.0.0-test';

        const result = spawnSync(process.execPath, [join(repoDir, 'scripts/stamp-versions.mjs'), version], {
            cwd: dir,
            encoding: 'utf8',
        });

        expect(result.status, result.stderr).toBe(0);

        const released = workspaces.map((workspace) => {
            const manifest: { name: string; version: string } = JSON.parse(
                readFileSync(join(dir, 'packages', workspace.name, 'package.json'), 'utf8')
            );

            return { name: manifest.name, version: manifest.version };
        });

        expect(released.toSorted((left, right) => left.name.localeCompare(right.name))).toEqual(
            supportedPackages.map((name) => ({ name, version }))
        );
    });
});
