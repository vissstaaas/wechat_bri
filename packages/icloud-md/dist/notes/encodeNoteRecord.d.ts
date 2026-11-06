import type { CloudKitRecord } from "../cloudkit/databaseClient.js";
export declare function deriveNoteTitle(text: string): string;
export declare function deriveNoteSnippet(text: string): string;
/** A modify-request field: bare `{value}` with no `type`, matching captured
 * web-client update operations (types only appear on the read side). */
export interface UpdateFieldValue {
    value: unknown;
}
/**
 * Assembles the full update field set: the new text data (already
 * re-encoded and zlib-compressed, passed base64), freshly derived display
 * metadata, and everything else echoed verbatim from the looked-up record.
 */
/**
 * The Folder reference every deletion stage points at. Apple's own client
 * never `forceDelete`s a note the user deletes - both stages of its deletion
 * flow are ordinary updates (see the 2026-07-16 lifecycle + purge HAR
 * captures in har_captures/): stage 1 reparents the note here, stage 2 sets
 * `Deleted: 1` with the note still parented here.
 */
export declare const TRASH_FOLDER_RECORD_NAME = "TrashFolder-CloudKit";
export declare function folderReference(folderRecordName: string, zoneOwnerRecordName?: string): unknown;
/**
 * Stage 1 of Apple's two-stage deletion: the field set that moves a note to
 * Recently Deleted, byte-matching the captured web-client request (see
 * har_captures/2026-07-16_note-lifecycle-create-table-delete.har, entry 56).
 * Works regardless of attachments - nothing is deleted, so no reference
 * validation can fail.
 */
export declare function buildNoteTrashFields(current: CloudKitRecord, nowMs: number): Record<string, UpdateFieldValue>;
/**
 * The field set that moves a note into an arbitrary folder - structurally
 * identical to the trash-move (Apple's "delete to Recently Deleted" IS a
 * folder move, see the lifecycle HAR analysis), just pointed at a real
 * folder instead of `TrashFolder-CloudKit`. The one write shape Step 4 of
 * the folders plan relies on, precisely because it was already proven live.
 */
export declare function buildNoteMoveFields(current: CloudKitRecord, folderRecordName: string, nowMs: number): Record<string, UpdateFieldValue>;
/**
 * Stage 2: the field set that permanently deletes an already-trashed note
 * (`Deleted: 1`; the server garbage-collects the record, its attachments,
 * and backing media asynchronously) - byte-matching the captured request
 * (har_captures/2026-07-16_purge-from-recently-deleted.har). Also moves the
 * note to Trash in the same update, so callers may run it directly against
 * a live note; the capture shows both fields together.
 */
export declare function buildNotePurgeFields(current: CloudKitRecord, nowMs: number): Record<string, UpdateFieldValue>;
/**
 * The field set for a brand-new note's `create` operation, byte-matching
 * the captured first-ever save (see
 * har_captures/2026-07-16_note-lifecycle-create-table-delete.har, entry 2,
 * analyzed in the 2026-07-16T10:50 dev notes): real date values (nothing to
 * echo on a create), both folder references at the default folder, derived
 * display metadata, the placeholder trio as literal `{}`, and notably NO
 * ReplicaIDToNotesVersionDataEncrypted - the capture simply omits it.
 */
export declare function buildNoteCreateFields(newTextDataBase64: string, newText: string, nowMs: number, folderRecordName?: string, zoneOwnerRecordName?: string): Record<string, UpdateFieldValue>;
/**
 * Assembles the full update field set: the new text data (already
 * re-encoded and zlib-compressed, passed base64), freshly derived display
 * metadata, and everything else echoed verbatim from the looked-up record.
 */
export declare function buildNoteUpdateFields(current: CloudKitRecord, newTextDataBase64: string, newText: string, modificationDateMs: number): Record<string, UpdateFieldValue>;
