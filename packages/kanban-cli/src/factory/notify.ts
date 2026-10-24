export const DEFAULT_NTFY_URL = 'http://100.79.92.93:8090/jott-factory';
const REASON_MAX = 200;
const TIMEOUT_MS = 10_000;

export interface NotifyEvent {
    kind: 'blocked' | 'done';
    project: string;
    number: number;
    title: string;
    reason?: string;
}

/** HTTP headers are ASCII only, so anything else goes as an RFC 2047 encoded word, which ntfy decodes. */
function headerValue(text: string): string {
    return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

export function notifyMessage(event: NotifyEvent): { title: string; body: string } {
    const title = `${event.project} #${event.number} ${event.kind}`;
    const reason = event.kind === 'blocked' ? event.reason?.split('\n')[0]?.trim().slice(0, REASON_MAX) : undefined;
    return { title, body: reason ? `${event.title}\n${reason}` : event.title };
}

/** Posts to ntfy. Never throws: a lost notification must not fail the run or the card. */
export async function notify(event: NotifyEvent, opts: { url?: string; fetch?: typeof fetch } = {}): Promise<void> {
    const { title, body } = notifyMessage(event);
    const url = opts.url ?? process.env.NTFY_URL ?? DEFAULT_NTFY_URL;
    try {
        const res = await (opts.fetch ?? fetch)(url, {
            method: 'POST',
            body,
            headers: {
                Title: headerValue(title),
                Tags: event.kind === 'done' ? 'white_check_mark' : 'warning',
                Markdown: 'no',
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({ ok: false, error: `notify failed: ${(error as Error).message}` })}\n`);
    }
}
