export declare const BUG_REPORT_ALIASES_FILE_NAME = "bug-report-aliases.json";
/**
 * Stable, arbitrary (not content-derived) aliases for the identifiers a bug
 * report would otherwise expose verbatim - note/folder/sharer/attachment
 * names and the account's dsid/appleId. Persisted locally per vault
 * (alongside state.json) so the same real note keeps the same `note-N`
 * alias across every future `bug-report`/`--identify` run, letting a
 * reporter reference "note-14" in conversation without ever typing its real
 * title. Aliases are assigned in first-seen order rather than derived from
 * the real value (e.g. a hash) on purpose - a content-derived alias for
 * something as low-entropy as a note title is crackable offline by a
 * motivated reader trying common titles against it.
 */
export interface BugReportAliasStore {
    notes: Record<string, string>;
    folders: Record<string, string>;
    sharerHomes: Record<string, string>;
    attachments: Record<string, string>;
    trashed: Record<string, string>;
    /** Keyed by the real dsid/appleId value itself (not a recordName - these
     * scalars have no other stable id to key off of). This file already sits
     * next to state.json, which stores the same real values in the clear, so
     * this doesn't add new exposure. */
    account: Record<string, string>;
}
export declare function emptyAliasStore(): BugReportAliasStore;
/** Reads the alias store, defaulting to empty if it's never been written or
 * doesn't parse - a bug-report run shouldn't fail over its own redaction
 * bookkeeping, it should just start fresh. */
export declare function readAliasStore(targetDir: string): Promise<BugReportAliasStore>;
export declare function writeAliasStore(targetDir: string, store: BugReportAliasStore): Promise<void>;
/** Returns this key's existing alias, or mints and records the next one in
 * that category (`note-1`, `note-2`, ...). Mutates `store` in place. */
export declare function resolveAlias(store: BugReportAliasStore, category: keyof BugReportAliasStore, key: string): string;
