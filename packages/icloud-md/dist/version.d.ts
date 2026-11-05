export interface EnvironmentInfo {
    toolVersion: string;
    nodeVersion: string;
    platform: string;
    osRelease: string;
}
/** Resolves relative to this module rather than `process.cwd()`, so it
 * reports this install's own version regardless of where the CLI is run
 * from - works identically from `src/version.ts` (via tsx) and the compiled
 * `dist/version.js`, since both sit one directory below the package root. */
export declare function readOwnPackageVersion(): string;
/** Gathers the version/environment details a bug report needs to tell one
 * install apart from another - see `runBugReport`. */
export declare function getEnvironmentInfo(): EnvironmentInfo;
