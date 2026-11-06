import type { DebugLogRecord } from "../debugLog.js";
import type { LastErrorRecord } from "../lastError.js";
import type { CloneState } from "./cloneState.js";
import { type BugReportAliasStore } from "./bugReportAliases.js";
/** Finds every real dsid/appleId value that appears anywhere in the state
 * or the captured debug log, so they can all be pseudonymized consistently
 * - including a bare `dsid` query-string param, which isn't a JSON field
 * itself but a substring of a URL. */
export declare function discoverAccountScalars(state: CloneState | undefined, logEntries: readonly DebugLogRecord[]): Set<string>;
/** Redacts the debug log slice bug-report bundles: drops real-name/email
 * identity fields, and pseudonymizes every dsid/appleId occurrence
 * (including inside URLs) via `accountAliasMap`. Cookie/session-token
 * redaction already happened when these entries were originally logged
 * (see debugLog.ts) - this only handles what that pass doesn't. */
export declare function redactDebugLogEntries(entries: readonly DebugLogRecord[], accountAliasMap: ReadonlyMap<string, string>): DebugLogRecord[];
export interface RedactedState {
    state: CloneState;
    /** Every real vault-relative path this pass replaced, mapped to its
     * aliased replacement - reused to scrub the same real strings out of
     * `lastError`'s free-text message/hint. */
    fileReplacements: Map<string, string>;
}
/**
 * Replaces every note/folder/sharer/attachment/trashed real name and the
 * account's dsid/appleId with stable aliases from `store` (minting new ones
 * as needed - callers persist `store` afterward). recordNames, change tags,
 * checksums, and timestamps are left untouched: they're already opaque and
 * are exactly the detail a bug report needs to be useful.
 */
export declare function redactCloneState(state: CloneState, store: BugReportAliasStore): RedactedState;
/** Builds the ordered (longest-first, so a full path is substituted before
 * its own basename could partially match something else) list of
 * real-to-alias text replacements for scrubbing `lastError`'s free-text
 * message/hint - which can legitimately quote a real file path or Apple ID
 * (e.g. AccountMismatchError, AmbiguousTrackedFileError). A real filename
 * the user typed but that was never actually tracked (a brand new local
 * file, or a typo) can't be caught this way - there's no record of it to
 * alias against - which is a known, documented gap. */
export declare function buildTextReplacements(fileReplacements: ReadonlyMap<string, string>, accountAliasMap: ReadonlyMap<string, string>): [string, string][];
export declare function redactLastError(lastError: LastErrorRecord | undefined, replacements: readonly [string, string][]): LastErrorRecord | undefined;
