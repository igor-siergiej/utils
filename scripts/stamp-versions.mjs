#!/usr/bin/env node
// Stamp a single version into the root manifest and every workspace package,
// so the semantic-release repo version stays in lockstep with the published
// package versions. Invoked from @semantic-release/exec's prepareCmd with the
// computed next version.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];

if (!version) {
    console.error('stamp-versions: a version argument is required');
    process.exit(1);
}

const stamp = (file) => {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    pkg.version = version;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`stamped ${pkg.name ?? file} -> ${version}`);
};

stamp('package.json');

for (const dir of readdirSync('packages')) {
    const manifest = join('packages', dir, 'package.json');
    if (existsSync(manifest)) {
        stamp(manifest);
    }
}
