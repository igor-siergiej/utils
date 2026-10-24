/** A row of `jott task list --json`. */
export interface JottTask {
    number: number;
    title: string;
    project: string | null;
    status: string;
    tags: string[];
    meta: Record<string, unknown>;
    position?: number;
}

const boardOrder = (a: JottTask, b: JottTask) => (a.position ?? 0) - (b.position ?? 0) || a.number - b.number;

function pausedUntil(t: JottTask): number | undefined {
    const at = t.meta.paused_until;
    return typeof at === 'string' ? Date.parse(at) : undefined;
}

/**
 * Next card to run: an in-progress card whose quota reset has passed, then Go-marked todo cards,
 * then (auto on) the rest of todo, each in board order. Inbox, backlog, blocked and done never run.
 */
export function nextCard(tasks: JottTask[], settings: { auto: boolean }, now: number): JottTask | undefined {
    const resumable = tasks.filter((t) => {
        const at = t.status === 'in_progress' ? pausedUntil(t) : undefined;
        return at !== undefined && at <= now;
    });
    const todo = tasks.filter((t) => t.status === 'todo');
    const go = todo.filter((t) => t.meta.go === true);
    const rest = settings.auto ? todo.filter((t) => t.meta.go !== true) : [];
    return [resumable, go, rest].map((group) => [...group].sort(boardOrder)[0]).find(Boolean);
}
