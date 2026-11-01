import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = join(packageDir, '.tmp-fixtures');
const oxlintBin = join(packageDir, 'node_modules', '.bin', 'oxlint');

// Fixtures live inside the package so that the self-referencing specifiers
// `@imapps/oxc-config/oxlint` and `@imapps/oxc-config/anti-slop` resolve to the built output.
mkdirSync(fixturesRoot, { recursive: true });

afterAll(() => {
    rmSync(fixturesRoot, { recursive: true, force: true });
});

interface Diagnostic {
    code: string;
    filename: string;
}

const lint = (files: Record<string, string>): Diagnostic[] => {
    const dir = mkdtempSync(join(fixturesRoot, 'case-'));

    for (const [name, source] of Object.entries(files)) {
        writeFileSync(join(dir, name), source);
    }

    writeFileSync(
        join(dir, 'oxlint.config.ts'),
        "import config from '@imapps/oxc-config/oxlint';\n\nexport default config;\n"
    );

    const result = spawnSync(oxlintBin, ['-c', 'oxlint.config.ts', '--format', 'json', ...Object.keys(files)], {
        cwd: dir,
        encoding: 'utf8',
    });
    const report: { diagnostics: Diagnostic[] } = JSON.parse(result.stdout);

    return report.diagnostics;
};

const cases: Record<string, string> = {
    'anti-slop(no-unknown-parameters)': 'export function f(x: unknown) { return x; }\n',
    'anti-slop(no-runtime-typeof)': "export function g(v: string | number) { return typeof v === 'string'; }\n",
    'anti-slop(no-module-mocking)': "import { vi } from 'vitest';\nvi.mock('./x');\n",
    'eslint(eqeqeq)': 'export const h = (a: number) => a == 1;\n',
};

describe('oxc-config oxlint preset', () => {
    for (const [code, source] of Object.entries(cases)) {
        it(`reports ${code}`, () => {
            const codes = lint({ 'case.ts': source }).map((diagnostic) => diagnostic.code);

            expect(codes).toContain(code);
        });
    }

    it('reports any in source files', () => {
        const codes = lint({ 'a.ts': 'export const x: any = 1;\n' }).map((diagnostic) => diagnostic.code);

        expect(codes).toContain('typescript(no-explicit-any)');
    });

    it('allows any in test files', () => {
        const codes = lint({ 'a.test.ts': 'export const x: any = 1;\n' }).map((diagnostic) => diagnostic.code);

        expect(codes).not.toContain('typescript(no-explicit-any)');
    });
});
