import { isRecord } from '../typeGuards';

/** What jott shows as a run's live activity: one line, never a tool result. */
export const ACTIVITY_MAX = 200;

const SECRET_ASSIGNMENT = /(token|secret|password|passwd|api[_-]?key|session)(["']?\s*[=:]\s*)\S+/gi;
/** A tool call touching the Bitwarden vault shows its name only: its args may hold the session key. */
const VAULT = /\bbw\s|BW_SESSION/;

/** Masks credentials the model may echo into its own text or tool args. Heuristic, not a guarantee. */
export function redact(text: string): string {
    return text.replace(/Bearer\s+\S+/g, 'Bearer ***').replace(SECRET_ASSIGNMENT, '$1=***');
}

function oneLine(text: string): string | undefined {
    const collapsed = redact(text.replace(/\s+/g, ' ').trim());
    return collapsed ? Array.from(collapsed).slice(0, ACTIVITY_MAX).join('') : undefined;
}

/**
 * The last text or tool call of an assistant message's content; thinking blocks are skipped.
 * `toolType`/`argsKey` name the harness's tool-call block (`toolCall`/`arguments`, `tool_use`/`input`).
 */
function lastActivity(content: unknown, toolType: string, argsKey: string): string | undefined {
    if (!Array.isArray(content)) return undefined;
    for (const block of content.toReversed()) {
        if (!isRecord(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) return oneLine(block.text);
        if (block.type === toolType && typeof block.name === 'string') {
            const args = JSON.stringify(block[argsKey] ?? {});
            return oneLine(VAULT.test(args) ? block.name : `${block.name} ${args}`);
        }
    }
    return undefined;
}

function parseLine(line: string): Record<string, unknown> | undefined {
    try {
        const parsed: unknown = JSON.parse(line);
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/** omp `--mode json`: assistant `message_update`/`message_end`/`turn_end`; `agent_end` transcripts are ignored. */
export function ompActivity(line: string): string | undefined {
    const event = parseLine(line);
    const message = event?.message;
    if (event?.type === 'agent_end' || !isRecord(message) || message.role !== 'assistant') return undefined;
    return lastActivity(message.content, 'toolCall', 'arguments');
}

/** claude `--output-format stream-json`: `type: assistant` events; `user` (tool results) are ignored. */
export function claudeActivity(line: string): string | undefined {
    const event = parseLine(line);
    if (event?.type !== 'assistant' || !isRecord(event.message)) return undefined;
    return lastActivity(event.message.content, 'tool_use', 'input');
}
