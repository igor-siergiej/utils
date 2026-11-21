import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        // Consumer tests launch CLI processes, including a cold nested Turbo invocation.
        testTimeout: 30_000,
    },
});
