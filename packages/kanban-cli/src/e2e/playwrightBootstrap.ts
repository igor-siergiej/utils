import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlaywrightAlreadyConfiguredError } from './errors';

const PLAYWRIGHT_CONFIG_TEMPLATE = `import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'e2e',
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
`;

const EXAMPLE_SPEC_TEMPLATE = `import { expect, test } from '@playwright/test';

test('homepage loads @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
});
`;

export interface BootstrapResult {
    filesWritten: string[];
}

export function scaffoldPlaywrightConfig(
    repoPath: string,
    options: { force?: boolean; configPath?: string } = {}
): BootstrapResult {
    const configPath = join(repoPath, options.configPath ?? 'playwright.config.ts');
    const e2eDir = join(repoPath, 'e2e');
    const specPath = join(e2eDir, 'example.spec.ts');

    if (!options.force && existsSync(configPath)) {
        throw new PlaywrightAlreadyConfiguredError(configPath);
    }

    mkdirSync(e2eDir, { recursive: true });
    writeFileSync(configPath, PLAYWRIGHT_CONFIG_TEMPLATE);
    writeFileSync(specPath, EXAMPLE_SPEC_TEMPLATE);

    const filesWritten = [configPath, specPath];

    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        pkg.scripts ??= {};
        if (!pkg.scripts['test:e2e']) {
            pkg.scripts['test:e2e'] = 'playwright test';
            writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
            filesWritten.push(pkgPath);
        }
    }

    return { filesWritten };
}
