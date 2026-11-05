import { type VersionSnapshot } from "../notes/versionHistory.js";
/** One record's comparison within an epoch diff - a note's own text, or one
 * of its table attachments. `skipped` covers every reason there's nothing to
 * diff (no snapshot ever captured, the snapshot no longer exists locally, or
 * the current remote content isn't available) - `text` carries the
 * human-readable explanation in that case instead of a rendered diff. */
export interface DiffEpochSection {
    label: string;
    skipped: boolean;
    hasDifferences?: boolean;
    text: string;
}
/** What `runDiff` reports - a single snapshot-vs-snapshot (or
 * snapshot-vs-current) comparison, or a whole-note epoch's per-record
 * breakdown. `hasDifferences` is the query-command signal `status`/`diff`
 * share: true means the CLI exits non-zero even though the diff itself
 * succeeded. */
export type DiffResult = {
    kind: "snapshot";
    from: string;
    to: string;
    hasDifferences: boolean;
    text: string;
} | {
    kind: "epoch";
    epochId: string;
    hasDifferences: boolean;
    sections: DiffEpochSection[];
};
/** Reassembles a `DiffResult` into the same report text `runDiff` used to
 * print directly - the CLI's human renderer. */
export declare function renderDiffResult(result: DiffResult): string;
/**
 * Diffs two renderings of the same note or table attachment - `fromId` is
 * always a snapshot id; `toId` is another snapshot id, or `undefined` to
 * mean "the current remote copy" (mirroring `git diff <commit>`'s implicit
 * comparison against the working tree). Both sides are decoded through the
 * same decoders `clone`/`pull` already use and diffed as rendered text -
 * meaningful to a human, unlike a binary diff of the raw protobuf.
 */
export declare function runDiff(targetDir: string, fileArg: string, fromId: string, toId: string | undefined, onLoginStatus?: (message: string) => void): Promise<DiffResult>;
/** Decodes a snapshot's raw bytes into the same rendered text form
 * `clone`/`pull` produce, so a diff compares meaningfully to a human
 * instead of the raw protobuf. */
export declare function decodeSnapshotText(snapshot: VersionSnapshot): string;
/** A rendered two-way diff, plus whether it found any actual differences -
 * the signal `runDiff` surfaces as its `hasDifferences` result field (query
 * commands, per the git `--exit-code` convention, exit non-zero when there
 * are differences to show). */
export interface RenderedDiff {
    text: string;
    hasDifferences: boolean;
}
/** Renders a unified-diff-style comparison of two texts using node-diff3's
 * plain two-way `diffComm` (already a dependency via `mergeConflict.ts`'s
 * 3-way merge, so this needs nothing new). */
export declare function renderDiff(fromText: string, toText: string, fromLabel: string, toLabel: string): RenderedDiff;
