import type { DebugLogRecord } from "../debugLog.js";
/**
 * One record's content, decoded from whatever `TextDataEncrypted`/
 * `TitleEncrypted`/`MergeableDataEncrypted` bytes turned up in the debug
 * log - the human-readable version of what `bug-report` would otherwise
 * only carry as an opaque compressed blob. This is deliberately generated
 * as a separate, local-only file (see renderContentPreview) rather than
 * folded into the shareable report: printing the same content in plain
 * text *inside* the file meant for a public GitHub issue would make things
 * worse, not better - the point is letting the reporter see what they're
 * about to expose before they decide whether/how to share it.
 */
export interface RecordContentPreview {
    recordName: string;
    recordType: string;
    kind: "note" | "table";
    title?: string;
    bodyText?: string;
    tableMarkdown?: string;
}
/** Decodes every distinct note/table content blob found across the debug
 * log slice a bug report bundles. Dedupes on (recordName, exact field
 * bytes) so the same unchanged record fetched twice (e.g. a lookup then a
 * changes/zone re-sync) only shows up once. */
export declare function buildContentPreview(logEntries: readonly DebugLogRecord[]): RecordContentPreview[];
export declare function renderContentPreview(previews: readonly RecordContentPreview[], generatedAt: Date): string;
