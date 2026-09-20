export class KanbanParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KanbanParseError';
    }
}

export class KanbanItemNotFoundError extends Error {
    constructor(id: string) {
        super(`Kanban item '${id}' was not found`);
        this.name = 'KanbanItemNotFoundError';
    }
}

export class KanbanColumnNotFoundError extends Error {
    constructor(column: string) {
        super(`Kanban column '${column}' does not exist on the board`);
        this.name = 'KanbanColumnNotFoundError';
    }
}

export class CaptureNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CaptureNotFoundError';
    }
}

export class InboxNotAWorkColumnError extends Error {
    constructor(column: string) {
        super(`'${column}' holds raw captures, not items — pick a work column`);
        this.name = 'InboxNotAWorkColumnError';
    }
}
