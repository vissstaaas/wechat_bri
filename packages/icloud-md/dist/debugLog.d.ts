/**
 * All request/response troubleshooting data lives here rather than on stdout,
 * in the same shared ~/.config/icloud-md/ directory that holds every
 * account's own subdirectory (see accountStore.ts) - this log itself stays
 * one file across all accounts, since it's just raw (redacted) HTTP traffic.
 */
export declare const DEFAULT_DEBUG_LOG_PATH: string;
export interface DebugLogEntry {
    note: string;
    request?: {
        method: string;
        url: string;
        headers: Record<string, string>;
    };
    response?: {
        status: number;
        headers: Record<string, string>;
        body: unknown;
    };
}
/** One line as actually written by `appendDebugLog` - the entry plus the timestamp it adds. */
export type DebugLogRecord = DebugLogEntry & {
    timestamp: string;
};
/** Appends one JSON-lines record. Sensitive header/body values are redacted before writing. */
export declare function appendDebugLog(entry: DebugLogEntry, debugLogPath?: string): Promise<void>;
/**
 * fetch() wrapper that logs the request and the response (status, headers,
 * best-effort JSON body) to the debug log, then hands the caller a Response
 * it can read normally.
 *
 * The body is read *once* here and a fresh `Response` is built around those
 * bytes. The previous revision logged from `response.clone()` and returned
 * the original for the caller to read, which broke against real CloudKit
 * traffic: every `changes/zone` fetch for a zone of any size came back to the
 * caller as `TypeError: Body is unusable: Body has already been read` from
 * its own `response.json()`, making `object list` unable to complete at all
 * (2026-08-02).
 *
 * What exactly upsets undici about that clone is *not* established: the
 * failure reproduces reliably against the live endpoint and did not reproduce
 * against a local server given the same response shape (gzip, chunked,
 * ~1 MB of JSON, sequential paged requests on a keep-alive connection, a
 * file-write await between the two reads). So the fix is the conservative
 * one - never hold two readers of the same body - rather than a workaround
 * aimed at a mechanism we would only be guessing at.
 */
export declare function loggedFetch(note: string, url: string, init: RequestInit & {
    headers: Record<string, string>;
}, debugLogPath?: string): Promise<Response>;
/**
 * Reads every already-redacted record logged at or after `since` - the slice
 * `bug-report` bundles. The log is one file shared across every account and
 * folder ever used on this machine (see the module doc comment above), so
 * this can't scope by folder; only the time range narrows it. Lines that
 * aren't valid JSON (or don't match the expected shape) are skipped rather
 * than failing the whole read - defensive against a log file interrupted
 * mid-write or hand-edited.
 */
export declare function readDebugLogSince(since: Date, debugLogPath?: string): Promise<DebugLogRecord[]>;
