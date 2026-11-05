import chalk from "chalk";
import { IcloudNotesSyncError } from "../errors.js";
export function createOutputContext(json) {
    return { json };
}
/** Renders a command's result: the raw value as JSON in `--json` mode
 * (stdout), or `renderHuman`'s own console output otherwise. */
export function emitResult(context, result, renderHuman) {
    if (context.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    renderHuman(result);
}
/** The sink every handler's `onLoginStatus`/`onStatus` callback is wired to:
 * routine status text goes to stdout for a human, but stderr in `--json`
 * mode so stdout stays pure JSON. `makeSyncProgress`'s ora spinner and
 * cli-progress bar already target stderr unconditionally, so they need no
 * json-specific handling beyond this. */
export function makeStatusSink(context) {
    return context.json ? (message) => console.error(message) : (message) => console.log(message);
}
/** Reports a thrown error on the appropriate stream for the mode, and
 * returns the exit code the process should use: `1` for a known, expected
 * `IcloudNotesSyncError`; `70` (`EX_SOFTWARE`) for anything else, a genuine
 * bug whose stack trace stays visible so it's debuggable. */
export function emitError(context, error) {
    if (error instanceof IcloudNotesSyncError) {
        if (context.json) {
            const payload = {
                error: error.name,
                message: error.message,
                exitCode: 1,
                ...(error.hint !== undefined ? { hint: error.hint } : {}),
            };
            console.error(JSON.stringify(payload, null, 2));
        }
        else {
            console.error(chalk.red(error.message));
            if (error.hint) {
                console.error(chalk.red(error.hint));
            }
        }
        return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    if (context.json) {
        const payload = {
            error: "InternalError",
            message,
            exitCode: 70,
            ...(stack !== undefined ? { stack } : {}),
        };
        console.error(JSON.stringify(payload, null, 2));
    }
    else {
        console.error(stack ?? message);
    }
    return 70;
}
/**
 * A commander usage error (unknown option, missing/extra argument, or a
 * manual `command.error(...)` call for a validation commander itself can't
 * express, e.g. a malformed `diff` ref). In human mode, commander has
 * already written `message` via its own output configuration - printing it
 * again here would duplicate it, so this only reports structurally in
 * `--json` mode (where the CLI configures commander's error output to stay
 * silent instead). Always returns `2`.
 */
export function emitUsageError(context, message) {
    if (context.json) {
        const payload = { error: "UsageError", message, exitCode: 2 };
        console.error(JSON.stringify(payload, null, 2));
    }
    return 2;
}
//# sourceMappingURL=output.js.map