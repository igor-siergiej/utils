import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = join(packageDir, '.tmp-fixtures', 'format');
const oxfmtBin = join(packageDir, 'node_modules', '.bin', 'oxfmt');

mkdirSync(fixturesRoot, { recursive: true });

afterAll(() => {
    rmSync(fixturesRoot, { recursive: true, force: true });
});

const format = (files: Record<string, string>): Record<string, string> => {
    const dir = mkdtempSync(join(fixturesRoot, 'fmt-'));

    for (const [name, source] of Object.entries(files)) {
        writeFileSync(join(dir, name), source);
    }

    writeFileSync(
        join(dir, 'oxfmt.config.ts'),
        "import config from '@imapps/oxc-config/oxfmt';\n\nexport default config;\n"
    );

    const result = spawnSync(oxfmtBin, ['-c', 'oxfmt.config.ts', ...Object.keys(files)], {
        cwd: dir,
        encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);

    return Object.fromEntries(Object.keys(files).map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
};

describe('oxc-config oxfmt preset', () => {
    it('sorts imports, uses single quotes and 4-space indent in TypeScript', () => {
        const { 'a.ts': output } = format({
            'a.ts': "import {b} from './b';\nimport a from \"a\";\nimport fs from 'node:fs';\nexport function f() {\nreturn [a, b, fs];\n}\n",
        });

        expect(output).toBe(
            "import fs from 'node:fs';\n\nimport a from 'a';\n\nimport { b } from './b';\nexport function f() {\n    return [a, b, fs];\n}\n"
        );
    });

    it('indents JSON with 2 spaces', () => {
        const { 'a.json': output } = format({ 'a.json': '{\n"a": {\n"b": [1, 2]\n}\n}\n' });

        expect(output).toBe('{\n  "a": {\n    "b": [1, 2]\n  }\n}\n');
    });
});
