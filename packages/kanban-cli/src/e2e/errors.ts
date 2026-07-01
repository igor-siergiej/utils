export class PlaywrightAlreadyConfiguredError extends Error {
    constructor(configPath: string) {
        super(`Playwright is already configured at '${configPath}' — pass --force to overwrite`);
        this.name = 'PlaywrightAlreadyConfiguredError';
    }
}
