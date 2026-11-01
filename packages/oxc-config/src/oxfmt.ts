import { defineConfig } from 'oxfmt';

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
    useTabs: false,
    tabWidth: 4,
    printWidth: 120,
    singleQuote: true,
    jsxSingleQuote: false,
    quoteProps: 'as-needed',
    trailingComma: 'es5',
    semi: true,
    arrowParens: 'always',
    bracketSameLine: false,
    bracketSpacing: true,
    sortImports: {},
    overrides: [{ files: ['**/*.json'], options: { tabWidth: 2 } }],
});
