/**
 * `dev.startCommand` for kanban-cli's `e2e local` gate (see .kanban-cli.json). utils is a library
 * monorepo with no app to start, but the gate always starts one and polls `dev.healthCheckUrl`
 * before it runs scripts/e2e.sh, so this answers that poll and nothing else. kanban-cli kills it
 * after the run.
 */
const port = 8798; // must match dev.healthCheckUrl in .kanban-cli.json

Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: (request) =>
        new URL(request.url).pathname === '/health' ? new Response('ok') : new Response('not found', { status: 404 }),
});

console.log(`e2e-server: listening on http://127.0.0.1:${port}/health`);
