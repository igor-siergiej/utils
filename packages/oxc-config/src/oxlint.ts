import { defineConfig } from 'oxlint';

const agentDirs = [
    '.agent',
    '.agents',
    '.claude',
    '.codex',
    '.continue',
    '.cursor',
    '.gemini',
    '.omp',
    '.opencode',
    '.pi',
    '.roo',
    '.windsurf',
];

export default defineConfig({
    ignorePatterns: [...agentDirs.map((dir) => `${dir}/**`), '**/.worktrees/**', '**/anti-slop/**'],
    plugins: ['typescript', 'oxc', 'jsx-a11y'],
    jsPlugins: [{ name: 'anti-slop', specifier: '@imapps/oxc-config/anti-slop' }],
    categories: { correctness: 'error' },
    rules: {
        'prefer-const': 'error',
        'prefer-template': 'error',
        eqeqeq: 'warn',
        'typescript/no-explicit-any': 'warn',
        'oxc/no-accumulating-spread': 'error',
        'anti-slop/no-array-filter-map': 'error',
        'anti-slop/no-reduce-accumulator-copy': 'error',
        'anti-slop/no-chained-type-assertions': 'error',
        'anti-slop/no-conditional-empty-object-spread': 'error',
        'anti-slop/no-known-value-widening': 'error',
        'anti-slop/no-module-mocking': 'error',
        'anti-slop/no-object-parameters': 'error',
        'anti-slop/no-reflect-apply': 'error',
        'anti-slop/no-reflect-get': 'error',
        'anti-slop/no-runtime-typeof': 'error',
        'anti-slop/no-shape-in-symbol-names': 'error',
        'anti-slop/no-unknown-parameters': 'error',
        'anti-slop/no-unknown-returns': 'error',
        'anti-slop/no-unknown-type-aliases': 'error',
        'anti-slop/no-unsafe-dictionary-type': 'error',
        'anti-slop/no-widen-then-assert': 'error',
        'anti-slop/require-readable-spacing': 'error',
        'anti-slop/require-safety-comment-for-type-assertion': 'error',
    },
    overrides: [
        {
            files: ['**/*.test.{ts,tsx,js,jsx}', '**/*.spec.{ts,tsx,js,jsx}'],
            rules: { 'typescript/no-explicit-any': 'off' },
        },
    ],
});
