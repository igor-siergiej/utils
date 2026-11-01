import { defineConfig } from 'tsup';

// Node refuses to type-strip .ts files under node_modules, and oxlint loads JS plugins
// through Node, so every entry point is shipped as built JS.
export default defineConfig({
    entry: { oxlint: 'src/oxlint.ts', oxfmt: 'src/oxfmt.ts', 'anti-slop': 'anti-slop/index.ts' },
    dts: { entry: { oxlint: 'src/oxlint.ts', oxfmt: 'src/oxfmt.ts' } },
    format: ['esm'],
    sourcemap: true,
    clean: true,
    target: 'node22',
    outDir: 'build',
    external: ['oxlint', 'oxfmt', '@oxlint/plugins'],
});
