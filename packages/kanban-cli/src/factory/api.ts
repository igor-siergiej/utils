import { z } from 'zod';

import { tryParseJson } from '../json';

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

const cardSchema = z.object({
    id: z.string(),
    number: z.number(),
    project: z.string().nullable(),
    title: z.string(),
});

const claimedRunSchema = z.object({
    id: z.string(),
    card: cardSchema,
    harness: z.string(),
    model: z.string(),
    resume_session: z.string().optional(),
    reply: z.string().optional(),
    blocked_reason: z.string().optional(),
});

const claimSchema = z.object({
    run: claimedRunSchema.nullable(),
    block: z.array(z.object({ card: cardSchema, reason: z.string() })),
});

const endAnswerSchema = z
    .union([z.object({ then: z.enum(['none', 'retry']) }), z.object({ then: z.literal('block'), reason: z.string() })])
    .transform((answer): EndAnswer =>
        answer.then === 'block' ? { action: 'block', reason: answer.reason } : { action: answer.then }
    );

const heartbeatSchema = z.object({ stop: z.boolean() });

const failureSchema = z.object({ error: z.unknown().optional() });

type RequestBody = EndBody | { activity?: string };

export function dispatcherApi(opts: ApiConfig & { fetch?: typeof fetch }): DispatcherApi {
    const base = opts.url.replace(/\/+$/, '');
    const doFetch = opts.fetch ?? fetch;

    async function post<T>(
        path: string,
        body: RequestBody | undefined,
        timeoutMs: number,
        schema: z.ZodType<T>
    ): Promise<T> {
        const headers = new Headers({ Authorization: `Bearer ${opts.token}` });

        if (body !== undefined) headers.set('Content-Type', 'application/json');

        const response = await doFetch(`${base}${path}`, {
            method: 'POST',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });

        const text = await response.text();
        const parsed = tryParseJson(text);

        if (!response.ok) {
            const failure = failureSchema.safeParse(parsed);

            const error =
                failure.success && failure.data.error !== undefined
                    ? String(failure.data.error)
                    : text.slice(0, 200) || response.statusText;

            throw new ApiError(response.status, `POST ${path} failed (${response.status}): ${error}`);
        }

        const result = schema.safeParse(parsed);

        if (!result.success) throw new Error(`POST ${path}: unexpected response ${text.slice(0, 200)}`);

        return result.data;
    }

    const runs = '/v1/dispatcher/runs/';

    return {
        claim: () => post('/v1/dispatcher/claim', undefined, CLAIM_TIMEOUT_MS, claimSchema),
        heartbeat: (id, activity) =>
            post(
                `${runs}${encodeURIComponent(id)}/heartbeat`,
                activity === undefined ? {} : { activity },
                REQUEST_TIMEOUT_MS,
                heartbeatSchema
            ),
        end: (id, body) => post(`${runs}${encodeURIComponent(id)}/end`, body, REQUEST_TIMEOUT_MS, endAnswerSchema),
    };
}
