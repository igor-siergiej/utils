import { isRecord } from '../typeGuards';

/** A card as the jott server knows it; `id` is stable, `number` can change on a sync collision. */
export interface ClaimCard {
    id: string;
    number: number;
    project: string | null;
    title: string;
}

export interface ClaimedRun {
    /** Server run id: heartbeat and end go to `/v1/dispatcher/runs/<id>`. */
    id: string;
    card: ClaimCard;
    harness: string;
    model: string;
    resume_session?: string;
    reply?: string;
    blocked_reason?: string;
}

/** Cards the server decided are blocked; the dispatcher applies the move locally. */
export interface ClaimBlock {
    card: ClaimCard;
    reason: string;
}

export interface Claim {
    run: ClaimedRun | null;
    block: ClaimBlock[];
}

export type EndOutcome = 'done' | 'blocked' | 'rate_limited' | 'failed' | 'stopped' | 'error';

export interface EndBody {
    outcome: EndOutcome;
    exit_code?: number;
    session_id?: string;
    /** Epoch ms; required for `rate_limited`. */
    resets_at?: number;
    summary?: string;
}

/**
 * The server's `{then, reason?}` answer to `end`: what the dispatcher does with the card.
 * `retry` and `none` mean nothing. Renamed from `then` so it never looks like a thenable.
 */
export type EndAnswer = { action: 'none' | 'retry' } | { action: 'block'; reason: string };

export interface DispatcherApi {
    claim(): Promise<Claim>;
    heartbeat(id: string, activity?: string): Promise<{ stop: boolean }>;
    end(id: string, body: EndBody): Promise<EndAnswer>;
}

/** The server answered with a non-2xx status. Network failures surface as the fetch error instead. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface ApiConfig {
    url: string;
    token: string;
}

/** The claim long-polls up to 25 s on the server; the rest are quick. */
const CLAIM_TIMEOUT_MS = 35_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function configFromEnv(env: Record<string, string | undefined> = process.env): ApiConfig {
    const url = env.JOTT_URL;
    const token = env.JOTT_DISPATCHER_TOKEN;
    if (!url || !token) {
        throw new Error('JOTT_URL and JOTT_DISPATCHER_TOKEN must be set (~/.config/kanban-factory.env)');
    }
    return { url, token };
}

function isCard(v: unknown): v is ClaimCard {
    return (
        isRecord(v) &&
        typeof v.id === 'string' &&
        typeof v.number === 'number' &&
        (v.project === null || typeof v.project === 'string') &&
        typeof v.title === 'string'
    );
}

const optionalString = (v: unknown) => v === undefined || typeof v === 'string';

function isClaimedRun(v: unknown): v is ClaimedRun {
    return (
        isRecord(v) &&
        typeof v.id === 'string' &&
        isCard(v.card) &&
        typeof v.harness === 'string' &&
        typeof v.model === 'string' &&
        optionalString(v.resume_session) &&
        optionalString(v.reply) &&
        optionalString(v.blocked_reason)
    );
}

function parseClaim(v: unknown): Claim | undefined {
    if (!isRecord(v) || !Array.isArray(v.block)) return undefined;
    const run = v.run === null ? null : isClaimedRun(v.run) ? v.run : undefined;
    if (run === undefined) return undefined;
    const block: ClaimBlock[] = [];
    for (const b of v.block) {
        if (!isRecord(b) || !isCard(b.card) || typeof b.reason !== 'string') return undefined;
        block.push({ card: b.card, reason: b.reason });
    }
    return { run, block };
}

function parseEndAnswer(v: unknown): EndAnswer | undefined {
    if (!isRecord(v)) return undefined;
    const action = v.then;
    if (action === 'none' || action === 'retry') return { action };
    if (action === 'block' && typeof v.reason === 'string') return { action, reason: v.reason };
    return undefined;
}

export function dispatcherApi(opts: ApiConfig & { fetch?: typeof fetch }): DispatcherApi {
    const base = opts.url.replace(/\/+$/, '');
    const doFetch = opts.fetch ?? fetch;

    async function post<T>(
        path: string,
        body: unknown,
        timeoutMs: number,
        parse: (v: unknown) => T | undefined
    ): Promise<T> {
        const response = await doFetch(`${base}${path}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${opts.token}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        let parsed: unknown;
        try {
            parsed = text ? JSON.parse(text) : undefined;
        } catch {
            parsed = undefined;
        }
        if (!response.ok) {
            const error =
                isRecord(parsed) && parsed.error !== undefined
                    ? String(parsed.error)
                    : text.slice(0, 200) || response.statusText;
            throw new ApiError(response.status, `POST ${path} failed (${response.status}): ${error}`);
        }
        const value = parse(parsed);
        if (value === undefined) throw new Error(`POST ${path}: unexpected response ${text.slice(0, 200)}`);
        return value;
    }

    const runs = '/v1/dispatcher/runs/';
    return {
        claim: () => post('/v1/dispatcher/claim', undefined, CLAIM_TIMEOUT_MS, parseClaim),
        heartbeat: (id, activity) =>
            post(
                `${runs}${encodeURIComponent(id)}/heartbeat`,
                activity === undefined ? {} : { activity },
                REQUEST_TIMEOUT_MS,
                (v) => (isRecord(v) && typeof v.stop === 'boolean' ? { stop: v.stop } : undefined)
            ),
        end: (id, body) => post(`${runs}${encodeURIComponent(id)}/end`, body, REQUEST_TIMEOUT_MS, parseEndAnswer),
    };
}
