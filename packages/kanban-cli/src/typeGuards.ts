/**
 * The package's canonical type guard. One place, so every reader of an untyped
 * value narrows the same way.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
