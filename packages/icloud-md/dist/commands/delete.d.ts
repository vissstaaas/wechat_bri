import { type CloudKitRecord } from "../cloudkit/databaseClient.js";
import { type CloneState, type CloneStateNoteEntry } from "../notes/cloneState.js";
import { type LocalFileState } from "../notes/localFileState.js";
export interface DeleteOptions {
    /** Also permanently delete (Apple's stage-2 purge, `Deleted: 1`) instead
     * of stopping at Recently Deleted. */
    hard?: boolean;
    onLoginStatus?: (message: string) => void;
}
/** Which of the four remote outcomes a delete resolved to - the CLI's human
 * renderer turns this (plus `localOutcome`) back into the message this
 * command used to print directly. */
export type DeleteOutcome = "already-deleted" | "already-trashed" | "trashed" | "purged";
export interface DeleteResult {
    file: string;
    outcome: DeleteOutcome;
    localOutcome: LocalFileState;
}
/**
 * Deletes a tracked note from iCloud the way Apple's own client does (see
 * the 2026-07-16 lifecycle/purge HAR analyses in the project notes): an
 * ordinary update moving the note to Recently Deleted, and - with `--hard` -
 * a second update setting `Deleted: 1` to permanently delete it. Neither
 * stage forceDeletes, so both work on notes with attachments, and neither
 * ever decodes note content - a note too broken to parse (the very case
 * `--hard` exists to repair) deletes just the same.
 *
 * A soft-deleted note stays reachable for a later `delete --hard <file>`
 * through the trash registry in state.json, even though its file and
 * tracking entry are cleaned up. Unlike `revert`, there's no confirmation
 * gate here - calling `delete <file>` at all is already the specific,
 * deliberate action, not a blind write of arbitrary content.
 *
 * A local edit made since the last sync is never silently discarded: the
 * file is left on disk (just untracked) rather than deleted along with the
 * remote note.
 */
export declare function runDelete(targetDir: string, fileArg: string, options?: DeleteOptions): Promise<DeleteResult>;
export declare function isInTrash(record: CloudKitRecord): boolean;
/** Whether the record already carries Apple's stage-2 `Deleted: 1` mark
 * (permanently deleted, awaiting server-side GC). */
export declare function isPurged(record: CloudKitRecord): boolean;
/** Records a soft-deleted note in the trash registry so `delete --hard`
 * can still find it after its file and tracking entry are gone. */
export declare function rememberTrashedNote(state: CloneState, recordName: string, file: string): void;
/**
 * Local cleanup shared by both the "already deleted remotely" and the
 * real-delete-just-succeeded paths - mirrors `pull`'s own handling of a
 * remotely-detected deletion (`handleRemoteDeletion`): a clean or missing
 * local file is removed/left alone with nothing to protect, but a locally
 * modified file is kept on disk (just dropped from tracking) rather than
 * destroyed along with the remote note. Mutates `state` in place.
 */
export declare function applyLocalNoteDeletion(targetDir: string, recordName: string, entry: CloneStateNoteEntry, state: CloneState): Promise<LocalFileState>;
/** Turns a `DeleteResult` back into the message this command used to print
 * directly - the CLI's human renderer. */
export declare function renderDeleteResult(result: DeleteResult): string;
