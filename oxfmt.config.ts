import base from '@imapps/oxc-config/oxfmt';
import { defineConfig } from 'oxfmt';

// Biome only formatted code and JSON here; keep docs/YAML (incl. the generated CHANGELOG.md) out of the formatter.
export default defineConfig({
    ...base,
    ignorePatterns: [...(base.ignorePatterns ?? []), '**/*.md', '**/*.{yml,yaml}', '.github-migrated'],
});
