import { type CloneState, type TitleMode } from "../notes/cloneState.js";
import type { SyncNotice, SyncProgress } from "../progress.js";
export type PullNotice = SyncNotice;
/** Which of the ways a pull can touch a local file this change represents.
 * "untrack" is a note left on disk but dropped from tracking (it became
 * unsyncable remotely) - the file stays, the sync relationship goes. */
export type PullChangeKind = "add" | "update" | "merge" | "remove" | "move" | "untrack";
export interface PullChangeRemark {
    /** "conflict": the reader must act, then re-sync (magenta on screen);
     * "unsyncable": content this tool can't sync as-is (black-on-red) -
     * mirroring the plan listing's conflict/refused split; "note": nothing to
     * do, just something that would otherwise be baffling (dim). */
    tone: "conflict" | "unsyncable" | "note";
    message: string;
}
/** One file-level thing this pull did, in the order it happened - both the
 * human changelist and `--json` consumers read from this. */
export interface PullChange {
    kind: PullChangeKind;
    file: string;
    /** Where the note lived before this pull moved it: a remote folder change
     * (kind "move"), or - in a filename-as-title vault - a remote *retitle*,
     * which renames the file and can land on any kind, since the note's
     * content usually changed in the same breath. */
    previousFile?: string;
    /** Set by `--defer-renames`: the path this file should be renamed to, which
     * this pull deliberately did *not* rename it to. The note stays at `file`
     * until a consumer performs it - see `pendingRename.ts`. */
    pendingRename?: string;
    remarks?: PullChangeRemark[];
}
export interface PullSummary {
    added: number;
    updated: number;
    merged: number;
    removed: number;
    attachmentsDownloaded: number;
    unpublishable: number;
    skippedNewUnsyncable: number;
    droppedUnsyncable: number;
    unsharedUntracked: number;
    changes: PullChange[];
    conflicts: string[];
    notices: PullNotice[];
}
export interface PullOptions {
    /** Don't rename files a remote retitle wants renamed - record the rename
     * and leave the file alone, for a consumer that can update wikilinks as it
     * goes. See `pendingRename.ts`; a no-op in an in-body vault, which never
     * renames anything. */
    deferRenames?: boolean;
}
export declare function runPull(targetDir: string, progress?: SyncProgress, onLoginStatus?: (message: string) => void, options?: PullOptions): Promise<PullSummary>;
/**
 * Renames a tracked note's file when the note's title changed remotely and
 * this vault carries titles in file names, returning the path it now lives
 * at (unchanged in every other case).
 *
 * The known cost, accepted when the mode was designed: a rename performed
 * outside Obsidian doesn't trigger its link updating, so wikilinks pointing
 * at a remotely-retitled note go stale. `context.defer` is `--defer-renames`,
 * which hands the rename to a consumer that can do better: the file stays
 * where it is and the target name comes back as `pendingRename` for the
 * caller to record. Deferring only applies to a file that's actually there -
 * a missing note is recreated further down, and recreating it under a title
 * it no longer has would be a rename nobody could complete.
 *
 * The new name is resolved against both the names this run has claimed and
 * what is actually on disk. Tracked names alone aren't enough here the way
 * they are for a brand-new note: this writes over an existing directory, and
 * an untracked file the user put there themselves must not be destroyed by
 * a rename landing on top of it.
 */
export declare function renameForRemoteTitle(targetDir: string, currentFile: string, titleLine: string, titleMode: "in-body" | "filename", context: {
    usedFileNames: Map<string, Set<string>>;
    onDisk: boolean;
    defer?: boolean;
}): Promise<{
    file: string;
    pendingRename?: string | undefined;
}>;
/**
 * Applies the deletions a from-scratch resync can only reveal by absence: a
 * note tracked to this zone (`sharedZoneOwner` `undefined` = the private
 * zone) whose record appears nowhere in the zone's complete listing no
 * longer exists remotely, and goes through the same remote-deletion handling
 * a tombstone would have driven - a clean local copy is removed, one with
 * local edits becomes a delete/modify conflict and stays put.
 *
 * `seenRecordNames` must come from the *complete* listing, every record type
 * included: matching on Note records alone would misread a record whose type
 * changed (e.g. a note that got password-protected) as a deletion. And it
 * must only ever be called for a zone whose full walk actually completed -
 * absence from a partial listing proves nothing.
 */
export declare function reconcileNotesAfterResync(targetDir: string, sharedZoneOwner: string | undefined, seenRecordNames: ReadonlySet<string>, notes: CloneState["notes"], attachments: NonNullable<CloneState["attachments"]>, tableAttachments: NonNullable<CloneState["tableAttachments"]>, summary: PullSummary, titleMode: TitleMode): Promise<number>;
/**
 * The 3-way merge `pull` runs when a note changed both remotely and locally.
 * The merge runs on the body only; the local-only frontmatter envelope is
 * split off and re-attached above the merged result.
 *
 * State discipline (established by the 2026-07-29 device-in-the-loop
 * experiments, vault dev log, matching push's planRemoteChangedMerge): on a
 * clean merge the base copy holds the *remote* text - the merge ancestor
 * going forward - never the merged result. Writing the merged text made the
 * merged file compare clean, so the local half of the merge silently never
 * uploaded on the next push. On a conflict the base copy stays untouched:
 * it remains the common ancestor until the markers are actually resolved.
 */
export declare function mergeRemoteChangeIntoLocalFile(targetDir: string, recordName: string, file: string, remoteBodyText: string, unrepresentableTitle?: string | undefined, titleMode?: TitleMode): Promise<{
    status: "merged" | "conflict" | "unresolvedMarkers";
}>;
