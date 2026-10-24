import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { harnessFor } from './harness';
import { ompArgv, parseOmpRun, UNATTENDED_OVERLAY } from './ompHarness';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/** The minute the recorded run started. */
const NOW = 1_792_867_400_000;

describe('parseOmpRun', () => {
    it('reads a normal run as done with its session id', () => {
        expect(parseOmpRun({ exitCode: 0, stdout: fixture('omp-done.jsonl'), stderr: '' }, NOW)).toEqual({
            kind: 'done',
            sessionId: '01a16f39-a3c1-7484-8ea2-ebc8fb1d1e7f',
        });
    });

    it('reads a quota wall as rate_limited, pausing until the provider says the limit lifts', () => {
        expect(parseOmpRun({ exitCode: 1, stdout: fixture('omp-rate-limited.jsonl'), stderr: '' }, NOW)).toEqual({
            kind: 'rate_limited',
            resetsAt: new Date(NOW + 1_596_488).toISOString(),
            sessionId: '01a16f39-829f-7495-9f75-7e3a45c79c98',
        });
    });

    it('reads a run that retried and recovered from a quota wall as done', () => {
        expect(parseOmpRun({ exitCode: 0, stdout: fixture('omp-recovered.jsonl'), stderr: '' }, NOW)).toEqual({
            kind: 'done',
            sessionId: '01a16f39-c0de-7a01-9b44-2f4f2a91d310',
        });
    });

    it('reads a provider failure in its real shape as failed, keeping the provider message', () => {
        expect(parseOmpRun({ exitCode: 1, stdout: fixture('omp-failed.jsonl'), stderr: '' }, NOW)).toEqual({
            kind: 'failed',
            exitCode: 1,
            summary: '500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
        });
    });

    it('fails a run that yielded with work still queued', () => {
        const stdout = `${JSON.stringify({ type: 'session', id: 's1' })}\n${JSON.stringify({
            type: 'agent_end',
            isTerminal: false,
        })}\n`;

        expect(parseOmpRun({ exitCode: 0, stdout, stderr: '' }, NOW)).toEqual({
            kind: 'failed',
            exitCode: 0,
            summary: 'the agent yielded with work still queued',
        });
    });

    it('pauses for the default window when a quota error carries no reset time', () => {
        const stdout = `${JSON.stringify({ type: 'session', id: 's1' })}\n${JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'quota exceeded' },
        })}\n`;

        expect(parseOmpRun({ exitCode: 1, stdout, stderr: '' }, NOW)).toEqual({
            kind: 'rate_limited',
            resetsAt: new Date(NOW + 30 * 60_000).toISOString(),
            sessionId: 's1',
        });
    });

    it('does not resume straight away when the provider reset has already passed', () => {
        const stdout = `${JSON.stringify({ type: 'session', id: 's1' })}\n${JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'quota exceeded', resets_at: (NOW - 60_000) / 1000 },
        })}\n`;

        expect(parseOmpRun({ exitCode: 1, stdout, stderr: '' }, NOW)).toEqual({
            kind: 'rate_limited',
            resetsAt: new Date(NOW + 30 * 60_000).toISOString(),
            sessionId: 's1',
        });
    });

    it('reads a non-zero exit with no limit as failed, keeping the tail of stderr', () => {
        const stderr = `${'x'.repeat(600)}boom`;

        expect(parseOmpRun({ exitCode: 2, stdout: '', stderr }, NOW)).toEqual({
            kind: 'failed',
            exitCode: 2,
            summary: stderr.slice(-500),
        });
    });

    it('reads an error event as failed, keeping its message', () => {
        const stdout = `${JSON.stringify({ type: 'session', id: 's' })}\n${JSON.stringify({
            type: 'error',
            code: 'runtime',
            message: 'tool crashed',
        })}\n`;

        expect(parseOmpRun({ exitCode: 0, stdout, stderr: '' }, NOW)).toEqual({
            kind: 'failed',
            exitCode: 0,
            summary: 'tool crashed',
        });
    });

    it('ignores lines that are not JSON', () => {
        const stdout = `warning: something\n${fixture('omp-done.jsonl')}`;

        expect(parseOmpRun({ exitCode: 0, stdout, stderr: '' }, NOW).kind).toBe('done');
    });

    it('fails a finished run that never reported a session id', () => {
        const stdout = `${JSON.stringify({ type: 'agent_end' })}\n`;

        expect(parseOmpRun({ exitCode: 0, stdout, stderr: '' }, NOW)).toEqual({
            kind: 'failed',
            exitCode: 0,
            summary: 'the run ended without a session id',
        });
    });
});

describe('ompArgv', () => {
    it('runs headless with auto-approved tools and a JSON event stream', () => {
        expect(ompArgv({ prompt: 'go' })).toEqual(['omp', '-p', 'go', '--mode', 'json', '--auto-approve']);
    });

    it('resumes the session it is given and loads the unattended overlay', () => {
        const argv = ompArgv({ prompt: 'go', resume: 's1', config: '/tmp/omp.yml' });

        expect(argv).toContain('--resume');
        expect(argv[argv.indexOf('--resume') + 1]).toBe('s1');
        expect(argv[argv.indexOf('--config') + 1]).toBe('/tmp/omp.yml');
    });

    it('runs the model it is given', () => {
        const argv = ompArgv({ prompt: 'go', model: 'minimax-code/MiniMax-M3' });

        expect(argv[argv.indexOf('--model') + 1]).toBe('minimax-code/MiniMax-M3');
    });

    it('turns the ask tool off so an unattended worker cannot wait for a human', () => {
        expect(UNATTENDED_OVERLAY).toContain('ask:');
        expect(UNATTENDED_OVERLAY).toContain('enabled: false');
    });
});

describe('harnessFor', () => {
    it('knows omp as well as claude', () => {
        expect(harnessFor('omp')).toBeDefined();
        expect(harnessFor('claude')).toBeDefined();
        expect(() => harnessFor('pi:minimax')).toThrow("Unknown agent 'pi:minimax'");
    });

    it('does not resolve a prototype member to a harness', () => {
        expect(() => harnessFor('toString')).toThrow("Unknown agent 'toString'");
        expect(() => harnessFor('constructor')).toThrow("Unknown agent 'constructor'");
    });
});
