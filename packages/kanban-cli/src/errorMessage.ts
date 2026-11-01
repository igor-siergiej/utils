/** The text of whatever a `catch` clause or rejected promise delivered. */
export const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
