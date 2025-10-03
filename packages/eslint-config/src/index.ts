import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
// @ts-expect-error - No types available for eslint-plugin-jsx-a11y
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

/**
 * Base ESLint configuration for IM Apps projects
 */
export const baseConfig = tseslint.config(
    // Base configuration for all files
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            '**/.yarn/**',
            '**/dev-dist/**',
            '**/test-results/**',
            '**/playwright-report/**',
            '**/*.tsbuildinfo',
            '**/.pnp.*',
            '**/*.pnp.*'
        ]
    },

    // Base TypeScript configuration for all TS/TSX files
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        extends: [
            eslint.configs.recommended,
            ...tseslint.configs.recommended,
            ...tseslint.configs.stylistic,
        ],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            'import': importPlugin,
            'simple-import-sort': simpleImportSort,
            'unused-imports': unusedImports,
            '@stylistic': stylistic,
        },
        rules: {
            // Apply stylistic rules first
            ...stylistic.configs.customize({
                braceStyle: '1tbs',
                commaDangle: 'only-multiline',
                indent: 4,
                quotes: 'single',
                semi: true,
                jsx: true,
            }).rules,

            // Extra line formatting rules
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
            '@stylistic/no-trailing-spaces': 'error',
            '@stylistic/eol-last': 'error',
            '@stylistic/padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: '*', next: 'return' },
                { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
                { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
                { blankLine: 'always', prev: 'directive', next: '*' },
                { blankLine: 'always', prev: 'block', next: '*' },
                { blankLine: 'always', prev: 'block-like', next: '*' },
            ],

            // TypeScript-specific rules (these override the extended configs)
            '@typescript-eslint/array-type': ['error', { default: 'generic', readonly: 'generic' }],
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
            '@typescript-eslint/no-unused-vars': 'off', // Let unused-imports handle this
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',

            // Import organization
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],

            // Import rules
            'import/first': 'error',
            'import/newline-after-import': 'error',
            'import/no-duplicates': 'error',
        },
    }
);

/**
 * Complete configuration for a typical monorepo project with React web and Node.js API
 */
export const monorepoConfig = tseslint.config(
    ...baseConfig,

    // React-specific configuration for web package
    {
        files: ['packages/web/**/*.{ts,tsx}', 'packages/*/web/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            'react': react,
            'react-hooks': reactHooks,
            'jsx-a11y': jsxA11y,
        },
        rules: {
            // React rules
            'react/jsx-uses-react': 'error',
            'react/jsx-uses-vars': 'error',
            'react/react-in-jsx-scope': 'off', // Not needed with new JSX transform
            'react/prop-types': 'off', // Using TypeScript for prop validation

            // React Hooks rules
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',

            // JSX A11y rules
            'jsx-a11y/alt-text': 'error',
            'jsx-a11y/anchor-has-content': 'error',
            'jsx-a11y/anchor-is-valid': 'error',
            'jsx-a11y/aria-props': 'error',
            'jsx-a11y/aria-proptypes': 'error',
            'jsx-a11y/aria-unsupported-elements': 'error',
            'jsx-a11y/click-events-have-key-events': 'warn',
            'jsx-a11y/heading-has-content': 'error',
            'jsx-a11y/img-redundant-alt': 'error',
            'jsx-a11y/no-access-key': 'error',
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },

    // Node.js specific configuration for API package
    {
        files: ['packages/api/**/*.ts', 'packages/*/api/**/*.ts'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },

    // Test files configuration (relaxed rules)
    {
        files: ['**/*.{test,spec}.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    // Configuration files (less strict)
    {
        files: ['**/*.config.{ts,js,mjs}', '**/vite.config.ts', '**/playwright*.config.ts', '**/tsup.config.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'import/no-default-export': 'off',
        },
    }
);

/**
 * Configuration for a single React application
 */
export const reactAppConfig = tseslint.config(
    ...baseConfig,

    // React-specific configuration
    {
        files: ['src/**/*.{ts,tsx}', '**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            'react': react,
            'react-hooks': reactHooks,
            'jsx-a11y': jsxA11y,
        },
        rules: {
            // React rules
            'react/jsx-uses-react': 'error',
            'react/jsx-uses-vars': 'error',
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',

            // React Hooks rules
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',

            // JSX A11y rules
            'jsx-a11y/alt-text': 'error',
            'jsx-a11y/anchor-has-content': 'error',
            'jsx-a11y/anchor-is-valid': 'error',
            'jsx-a11y/aria-props': 'error',
            'jsx-a11y/aria-proptypes': 'error',
            'jsx-a11y/aria-unsupported-elements': 'error',
            'jsx-a11y/click-events-have-key-events': 'warn',
            'jsx-a11y/heading-has-content': 'error',
            'jsx-a11y/img-redundant-alt': 'error',
            'jsx-a11y/no-access-key': 'error',
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },

    // Test files configuration (relaxed rules)
    {
        files: ['**/*.{test,spec}.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    // Configuration files (less strict)
    {
        files: ['**/*.config.{ts,js,mjs}', '**/vite.config.ts', '**/playwright*.config.ts', '**/tsup.config.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'import/no-default-export': 'off',
        },
    }
);

/**
 * Configuration for a Node.js API application
 */
export const nodeAppConfig = tseslint.config(
    ...baseConfig,

    // Node.js specific configuration
    {
        files: ['src/**/*.ts', '**/*.ts'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },

    // Test files configuration (relaxed rules)
    {
        files: ['**/*.{test,spec}.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    // Configuration files (less strict)
    {
        files: ['**/*.config.{ts,js,mjs}', '**/vite.config.ts', '**/playwright*.config.ts', '**/tsup.config.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'import/no-default-export': 'off',
        },
    }
);

// Default export is the monorepo config
export default monorepoConfig;
