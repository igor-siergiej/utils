export class GhNotFoundError extends Error {
    constructor() {
        super(
            "The 'gh' CLI was not found on PATH. Install and authenticate GitHub CLI " +
                "(https://cli.github.com) before using kanban-cli's GitHub commands."
        );
        this.name = 'GhNotFoundError';
    }
}

export class GhCommandError extends Error {
    constructor(argv: string[], exitCode: number, stderr: string) {
        super(`gh ${argv.join(' ')} exited with code ${exitCode}: ${stderr.trim()}`);
        this.name = 'GhCommandError';
    }
}
