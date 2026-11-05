export interface RevertOptions {
    /** The actual server-side write only fires with this set - without it,
     * `revert` fetches the target record, verifies the historical bytes are
     * safe to write, and reports what it *would* do, given the stakes of a
     * real remote write. */
    confirmed: boolean;
    onLoginStatus?: (message: string) => void;
}
export interface RevertRecordOutcome {
    label: string;
    status: "reverted" | "failed" | "no-result";
    detail?: string;
}
export interface RevertPreviewEntry {
    label: string;
    timestamp: string;
}
/**
 * What `runRevert` did or would do. `mode: "snapshot"` is a single
 * record's revert (the note's own text, or one table); `mode: "epoch"` is a
 * whole-note batch. `confirmed` mirrors `RevertOptions.confirmed` - false
 * means nothing was written, and `entries`/`nothingToRevert` describe the
 * preview; true means the write(s) happened, and `results` describes the
 * outcome per record. `nothingToRevert`, when present, means the epoch had
 * nothing to act on - either every record was skipped locally (no snapshot
 * ever captured, or one that no longer exists on disk) before any network
 * call, or every targeted record turned out to be gone remotely once
 * `confirmed` lookups ran.
 */
export interface RevertResult {
    mode: "snapshot" | "epoch";
    confirmed: boolean;
    timestamp: string;
    /** mode "snapshot" only. */
    targetDescription?: string;
    snapshotId?: string;
    /** mode "epoch" only. */
    epochId?: string;
    nothingToRevert?: "locally-skipped" | "remote-missing";
    /** mode "epoch", confirmed false, something to revert. */
    entries?: RevertPreviewEntry[];
    /** mode "epoch", confirmed true, something reverted. */
    results?: RevertRecordOutcome[];
    /** mode "epoch" only: skip explanations for records not covered above. */
    notices?: string[];
}
/**
 * The real server-side write-back, generalizing exactly what manual
 * incident recovery did by hand (2026-07-15T17:13 dev note): fetch the
 * target record fresh for its current recordChangeTag, round-trip-verify
 * the historical bytes through our own model as a safety gate (the same
 * discipline `push` already applies to new edits, applied here to a
 * snapshot instead), submit via `updateRecords` with that fresh tag.
 *
 * `id` may be a per-record snapshot id, or a whole-note epoch id (see the
 * "Whole-note coordinated version epochs" investigation) - epoch lookup is
 * a separate, sibling path (`findEpochById`) tried only after the ordinary
 * snapshot lookup misses, rather than folding both into one return shape;
 * they're different operations downstream (one write vs. a batch of them),
 * not one operation wearing two shapes.
 *
 * Deliberately not the same thing as the existing `restore` command -
 * `restore` is local-only (overwrites the working file from the base copy,
 * no network call); `revert` is a real remote write.
 */
export declare function runRevert(targetDir: string, fileArg: string, id: string, options: RevertOptions): Promise<RevertResult>;
/** Reassembles a `RevertResult` into the same lines this command used to
 * print directly - the CLI's human renderer. */
export declare function renderRevertResult(fileArg: string, result: RevertResult): string[];
