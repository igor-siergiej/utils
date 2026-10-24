import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeArgv, parseClaudeRun } from './claudeHarness';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseClaudeRun', () => {
    it('reads a normal run as done with its session id', () => {
        expect(parseClaudeRun({ exitCode: 0, stdout: fixture('claude-done.jsonl'), stderr: '' })).toEqual({
            kind: 'done',
            sessionId: 'd13207d3-a65b-415a-8dde-ef688ea44505',
        });
    });

    it('reads a rejected rate-limit event as rate_limited with the latest rejected reset', () => {
        expect(parseClaudeRun({ exitCode: 1, stdout: fixture('claude-rate-limited.jsonl'), stderr: '' })).toEqual({
            kind: 'rate_limited',
            resetsAt: new Date(1792818600 * 1000).toISOString(),
            sessionId: '5b0c41de-7b51-4d8e-9a43-0e7c2a1f9d10',
        });
    });

    it('reads a non-zero exit with no limit as failed, keeping the tail of stderr', () => {
        const stderr = `${'x'.repeat(600)}boom`;

        const outcome = parseClaudeRun({ exitCode: 2, stdout: '', stderr });

        expect(outcome).toEqual({ kind: 'failed', exitCode: 2, summary: stderr.slice(-500) });
    });

    it('reads an error result with exit 0 as failed', () => {
        const stdout =
            '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"tool crashed","session_id":"s"}\n';

        expect(parseClaudeRun({ exitCode: 0, stdout, stderr: '' })).toEqual({
            kind: 'failed',
            exitCode: 0,
            summary: 'tool crashed',
        });
    });

    it('ignores lines that are not JSON', () => {
        const stdout = `warning: something\n${fixture('claude-done.jsonl')}`;

        expect(parseClaudeRun({ exitCode: 0, stdout, stderr: '' }).kind).toBe('done');
    });
});

describe('claudeArgv', () => {
    it('runs headless with skipped permissions and stream-json, resuming when asked', () => {
        expect(claudeArgv({ prompt: 'go' })).toEqual([
            'claude',
            '-p',
            '--dangerously-skip-permissions',
            '--output-format',
            'stream-json',
            '--verbose',
            'go',
        ]);
        expect(claudeArgv({ prompt: 'go', resume: 's1' })).toContain('--resume');
    });

    it('runs the model it is given', () => {
        const argv = claudeArgv({ prompt: 'go', model: 'MiniMax-M3' });

        expect(argv[argv.indexOf('--model') + 1]).toBe('MiniMax-M3');
    });
});
