export interface E2eResult {
    passed: boolean;
    failedTests: string[];
    reportPath?: string;
    durationMs: number;
    startedApp: boolean;
    tearDownOk: boolean;
}
