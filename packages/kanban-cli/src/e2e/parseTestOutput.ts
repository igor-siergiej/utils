/** Playwright's default reporter prints failing specs like "  1) e2e/checkout.spec.ts:34 > rounds totals correctly". */
export function extractFailedTests(output: string): string[] {
    return output
        .split('\n')
        .filter((line) => /^\s*\d+\)\s+/.test(line))
        .map((line) => line.replace(/^\s*\d+\)\s+/, '').trim());
}
