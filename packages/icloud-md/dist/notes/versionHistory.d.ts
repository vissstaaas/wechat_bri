export interface VersionSnapshot {
    id: string;
    timestamp: string;
    /** The Note's or the table Attachment's own recordName. */
    recordName: string;
    recordType: "Note" | "Attachment";
    field: "TextDataEncrypted" | "MergeableDataEncrypted";
    /** The tag this snapshot corresponds to. */
    recordChangeTag: string;
    /** The raw field bytes, verbatim. */
    valueBase64: string;
    /** For an Attachment snapshot, which note it belongs to (grouping/display). */
    noteRecordName?: string | undefined;
}
/** Everything `recordVersion` needs to capture a snapshot - `id`/`timestamp`
 * are stamped at capture time, not supplied by the caller. */
export type VersionSnapshotInput = Omit<VersionSnapshot, "id" | "timestamp">;
/**
 * Append-only capture of `input`, unless its `valueBase64` is identical to
 * the single most-recent existing snapshot for that `recordName` - in which
 * case this is a no-op. Comparing only against the immediately preceding
 * snapshot (not the full history) means a real revert-and-forward transition
 * (A -> B -> A) still records both edges; only exact, consecutive repeats -
 * e.g. from a no-op pull/push - get skipped.
 *
 * Returns whether a new snapshot was actually written - `pull`/`push` use
 * this to decide whether anything changed for a note this run at all, and so
 * whether a coordinated epoch is worth recording (see `noteEpoch.ts`).
 */
export declare function recordVersion(targetDir: string, input: VersionSnapshotInput): Promise<boolean>;
/** Every snapshot recorded for `recordName`, oldest first (filenames sort
 * naturally by capture time). Empty if none exist. */
export declare function listVersions(targetDir: string, recordName: string): Promise<VersionSnapshot[]>;
