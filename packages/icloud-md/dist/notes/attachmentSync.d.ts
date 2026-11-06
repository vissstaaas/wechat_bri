import { type CloudKitDatabase, type CloudKitRecord, type CloudKitZoneID } from "../cloudkit/databaseClient.js";
import type { IcloudSession } from "../session.js";
import type { CloneStateAttachmentEntry, CloneStateTableAttachmentEntry } from "./cloneState.js";
import { type AttachmentReference, type EmbedSlot } from "./noteAttachments.js";
export interface AttachmentAuth {
    session: IcloudSession;
    ckdatabasewsUrl: string;
    dsid: string;
}
/** One attachment resolved to a concrete local file, ready to be written
 * (if `needsDownload`) and tracked. Pure data - no I/O has happened yet. */
export interface MatchedAttachment {
    /** The Attachment record's recordName - state.attachments' key. */
    recordName: string;
    /** Vault-root-relative path of the attachment file - attachments live in
     * an `attachments/` directory next to their note (per-folder, see the
     * folders doc, 2026-07-16T21:29). */
    relativeFile: string;
    /** The same file relative to the note's own directory - what the note
     * body's markdown link uses. */
    linkPath: string;
    needsDownload: boolean;
    downloadURL: string;
    entry: CloneStateAttachmentEntry;
}
/**
 * Given a note's attachment references and the already-fetched `Attachment`
 * records they name, returns each one's `Media` recordName - the next hop
 * to look up - in the same order as `refs`. An entry is `undefined` where a
 * reference doesn't resolve to a real `Attachment` record with a `Media`
 * reference; per the Safety Guarantee Audit, that degrades just that one
 * embed (an unknown-content marker) rather than refusing the whole note.
 */
export declare function extractMediaRecordNames(refs: readonly AttachmentReference[], attachmentRecords: readonly CloudKitRecord[]): (string | undefined)[];
/**
 * Matches each attachment reference to its `Media` record (already fetched,
 * one per ref, same order as `mediaRecordNames` from
 * `extractMediaRecordNames`) and decides a local file name and whether it
 * needs (re)downloading. An entry is `undefined` where the `Media` record is
 * missing, isn't actually a `Media` record, or lacks a well-formed `Asset`
 * field; per the Safety Guarantee Audit, that degrades just that one embed
 * rather than refusing the whole note.
 */
export declare function matchAttachmentRecords(refs: readonly AttachmentReference[], mediaRecordNames: readonly (string | undefined)[], mediaRecords: readonly CloudKitRecord[], noteRecordName: string, existingAttachments: Record<string, CloneStateAttachmentEntry>, usedAttachmentFileNames: Set<string>, noteDir: string): (MatchedAttachment | undefined)[];
/** A resolved table's raw `MergeableDataEncrypted` bytes plus enough
 * identity to snapshot it into version history - deliberately separate from
 * `CloneStateTableAttachmentEntry` (which is state-tracking only, no raw
 * bytes) since not every caller of `resolveNoteAttachments` wants to pay for
 * building version snapshots. */
export interface TableAttachmentSnapshotSource {
    recordName: string;
    noteRecordName: string;
    recordChangeTag: string;
    valueBase64: string;
}
export interface AttachmentSyncResult {
    /** `bodyText` with each U+FFFC placeholder replaced by a markdown embed/link. */
    bodyText: string;
    /** This note's current attachments, keyed by Attachment recordName - merge into state.attachments. */
    attachments: Record<string, CloneStateAttachmentEntry>;
    /** Previously-tracked attachment recordNames for this note that are no
     * longer referenced (the note was edited to remove one) - the caller
     * should delete their files and drop these keys from state.attachments. */
    staleAttachmentRecordNames: string[];
    /** This note's current table attachments, keyed by Attachment recordName -
     * merge into state.tableAttachments. */
    tableAttachments: Record<string, CloneStateTableAttachmentEntry>;
    /** Previously-tracked table attachment recordNames for this note that are
     * no longer referenced - the caller should drop these keys from
     * state.tableAttachments (no file to delete, unlike a file attachment). */
    staleTableAttachmentRecordNames: string[];
    /** One entry per table reference that resolved this call - the caller
     * (`pull`) feeds these into `versionHistory.ts`'s `recordVersion`. */
    tableAttachmentSnapshots: TableAttachmentSnapshotSource[];
}
/**
 * Resolves every embedded reference a note contains - downloading file
 * attachments into `attachments/` and rendering a table's structure as a
 * markdown table inline - and rewrites the note's placeholders accordingly.
 *
 * A `com.apple.notes.table` reference is an `Attachment` record like any
 * other, but its payload lives directly on that record's own
 * `MergeableDataEncrypted` field rather than chaining through `Media` -
 * see `decodeTableRecord.ts` and dev notes, 2026-07-14T10:10/14:46.
 *
 * Per the Safety Guarantee Audit, a reference that doesn't match what we've
 * verified live - a file reference whose `Attachment`/`Media`/`Asset` chain
 * doesn't resolve, a table whose `MergeableDataEncrypted` doesn't decode, or
 * a placeholder with no usable `attachmentInfo` at all (an `unknown` slot) -
 * doesn't refuse the whole note. That one placeholder gets an inline embed
 * marker (see `formatEmbedMarker`) carrying whatever identity it has, and
 * the rest of the note still comes through. Since Step 1 of the formatting
 * plan (2026-07-17) a marker no longer makes the note unpublishable either -
 * `push` verifies markers survive verbatim instead. The actual matching
 * (`extractMediaRecordNames`/`matchAttachmentRecords`, `decodeTableMarkdown`)
 * is pure and unit-tested against real captures; this function is the thin
 * network+fs wrapper around it, verified live instead.
 */
export declare function resolveNoteAttachments(auth: AttachmentAuth, database: CloudKitDatabase, zoneID: CloudKitZoneID, targetDir: string, noteRecordName: string, bodyText: string, slots: readonly EmbedSlot[], existingAttachments: Record<string, CloneStateAttachmentEntry>, existingTableAttachments: Record<string, CloneStateTableAttachmentEntry>, usedAttachmentFileNames: Set<string>, noteDir: string): Promise<AttachmentSyncResult>;
/** Decodes a table reference's `MergeableDataEncrypted` payload into
 * markdown, or `undefined` if the record doesn't match what's been
 * verified live (missing/malformed, or a table shape this decoder refuses -
 * e.g. right-to-left column direction). The caller (`resolveNoteAttachments`)
 * turns `undefined` into an inline unknown-content marker for just this one
 * reference rather than guessing at its structure. */
export declare function decodeTableAttachment(attachmentRecord: CloudKitRecord | undefined): string | undefined;
/** Deletes every attachment file tracked for a note (it was deleted, or
 * dropped from tracking entirely) and returns the recordNames removed, so
 * the caller can drop them from `state.attachments`. */
export declare function removeAttachmentsForNote(targetDir: string, noteRecordName: string, attachments: Record<string, CloneStateAttachmentEntry>): Promise<string[]>;
/** Drops table-attachment tracking entries for a note - no file to delete (a
 * table has no downloaded file, just its rendered markdown inline), so this
 * is pure bookkeeping. Returns the recordNames removed, so the caller can
 * drop them from `state.tableAttachments`. */
export declare function removeTableAttachmentsForNote(noteRecordName: string, tableAttachments: Record<string, CloneStateTableAttachmentEntry>): string[];
