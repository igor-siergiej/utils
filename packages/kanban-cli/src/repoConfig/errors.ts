export class RepoConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepoConfigError';
    }
}
