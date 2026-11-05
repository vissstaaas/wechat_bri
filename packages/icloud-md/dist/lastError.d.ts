/** Same shared `~/.config/icloud-md/` directory as the debug log and
 * account store - see `debugLog.ts`'s `DEFAULT_DEBUG_LOG_PATH`. */
export declare const DEFAULT_LAST_ERROR_PATH: string;
export interface LastErrorRecord {
    timestamp: string;
    message: string;
    hint?: string;
}
/**
 * Persists the message/hint of the most recent CLI failure, so `bug-report`
 * can include it verbatim rather than relying on the user to have copied it
 * from a scrolled-past terminal. Overwrites any previous record - only the
 * latest failure matters for troubleshooting.
 */
export declare function recordLastError(error: unknown, filePath?: string): Promise<void>;
/** Returns `undefined` if no failure has been recorded yet (or the file was removed). */
export declare function readLastError(filePath?: string): Promise<LastErrorRecord | undefined>;
