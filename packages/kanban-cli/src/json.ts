import { z } from 'zod';

/** Any value `JSON.parse` can produce. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/**
 * `JSON.parse` that answers `undefined` for empty or malformed text instead of throwing.
 * The result is untyped (`any`): hand it straight to a schema's `safeParse`, never read it directly.
 */
export function tryParseJson(text: string) {
    if (!text) return undefined;

    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// Shallow on purpose: provider event streams carry whole transcripts, and the readers below
// only look at a few top-level fields.
const objectSchema = z.record(z.string(), z.any());
const arraySchema = z.array(z.any());

/** `value` when it is a plain JSON object (not an array, not null), else `undefined`. */
export const jsonObject = (value: JsonValue | undefined): JsonObject | undefined => objectSchema.safeParse(value).data;

/** `value` when it is a JSON array, else `undefined`. */
export const jsonArray = (value: JsonValue | undefined): JsonValue[] | undefined => arraySchema.safeParse(value).data;

/** `value` when it is a string, else `undefined`. */
export const jsonString = (value: JsonValue | undefined) => z.string().safeParse(value).data;

/** `value` when it is a number, else `undefined`. */
export const jsonNumber = (value: JsonValue | undefined) => z.number().safeParse(value).data;

/** One line of a JSON-lines stream as an object; `undefined` for blank, malformed, or non-object lines. */
export const parseJsonObject = (text: string): JsonObject | undefined => jsonObject(tryParseJson(text));
