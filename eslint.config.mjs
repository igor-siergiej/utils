import { nodeAppConfig } from '@imapps/eslint-config';

export default [
    ...nodeAppConfig,
    {
        files: ['**/types/**/*.ts', '**/*.types.ts', '**/*.enum.ts', '**/lib/**/types.ts'],
        rules: {
            'unused-imports/no-unused-vars': 'off',
        },
    },
];
