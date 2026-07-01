import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        coverage: {
            reporter: ['text', 'html', 'lcov'],
            exclude: ['build/**', 'tsup.config.ts', 'vitest.config.ts'],
        },
    },
});
