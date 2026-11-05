import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
/** Resolves relative to this module rather than `process.cwd()`, so it
 * reports this install's own version regardless of where the CLI is run
 * from - works identically from `src/version.ts` (via tsx) and the compiled
 * `dist/version.js`, since both sit one directory below the package root. */
export function readOwnPackageVersion() {
    const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const raw = readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.version !== "string") {
        throw new Error(`${packageJsonPath} is missing a "version" field.`);
    }
    return parsed.version;
}
/** Gathers the version/environment details a bug report needs to tell one
 * install apart from another - see `runBugReport`. */
export function getEnvironmentInfo() {
    return {
        toolVersion: readOwnPackageVersion(),
        nodeVersion: process.version,
        platform: os.platform(),
        osRelease: os.release(),
    };
}
//# sourceMappingURL=version.js.map