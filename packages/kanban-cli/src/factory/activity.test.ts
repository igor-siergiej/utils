import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeActivity, ompActivity, redact } from './activity';

const fixture = (name: string) =>
    readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
        .split('\n')
        .filter(Boolean);

/** Activity for each line that has one, in stream order. */
const activities = (lines: string[], extract: (line: string) => string | undefined) =>
    lines.map(extract).filter((a) => a !== undefined);

const ompAssistant = (content: unknown[]) =>
    JSON.stringify({ type: 'message_end', message: { role: 'assistant', content } });
const claudeAssistant = (content: unknown[]) =>
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });

describe('ompActivity', () => {
    it('reads tool calls and assistant text from a real run, never thinking, results or the transcript', () => {
        expect(activities(fixture('omp-tool-call.jsonl'), ompActivity)).toEqual([
            'bash {"i":"Running echo hello-factory","command":"echo hello-factory"}',
            'bash {"i":"Running echo hello-factory","command":"echo hello-factory"}',
            'DONE',
            'DONE',
        ]);
    });

    it('ignores a message of only thinking', () => {
        expect(ompActivity(ompAssistant([{ type: 'thinking', thinking: 'plan' }]))).toBeUndefined();
    });

    it('collapses whitespace and cuts to 200 characters', () => {
        const text = `a\n\n  b ${'x'.repeat(300)}`;
        const activity = ompActivity(ompAssistant([{ type: 'text', text }]));
        expect(activity).toHaveLength(200);
        expect(activity?.startsWith('a b xxx')).toBe(true);
    });

    it('shows only the tool name for a call that touches the vault', () => {
        const call = { type: 'toolCall', name: 'bash', arguments: { command: 'export BW_SESSION=abc; bw get item x' } };
        expect(ompActivity(ompAssistant([call]))).toBe('bash');
    });
});

describe('claudeActivity', () => {
    it('reads tool_use and assistant text from a real run, never tool results', () => {
        expect(activities(fixture('claude-tool-use.jsonl'), claudeActivity)).toEqual([
            'Bash {"command":"echo hello-factory","description":"Echo hello-factory"}',
            'DONE',
        ]);
    });

    it('takes the last text or tool block of a message', () => {
        const line = claudeAssistant([
            { type: 'text', text: 'Running the tests' },
            { type: 'tool_use', name: 'Bash', input: { command: 'bun run test' } },
        ]);
        expect(claudeActivity(line)).toBe('Bash {"command":"bun run test"}');
    });
});

describe('redact', () => {
    it('masks bearer tokens and secret assignments', () => {
        expect(redact('curl -H "Authorization: Bearer abc123" http://x')).toBe(
            'curl -H "Authorization: Bearer *** http://x'
        );
        expect(redact('token=abc TOKEN: def api_key=g BW_SESSION=h')).toBe(
            'token=*** TOKEN=*** api_key=*** BW_SESSION=***'
        );
    });

    it('applies to activity text', () => {
        expect(claudeActivity(claudeAssistant([{ type: 'text', text: 'set password=hunter2 now' }]))).toBe(
            'set password=*** now'
        );
    });
});
