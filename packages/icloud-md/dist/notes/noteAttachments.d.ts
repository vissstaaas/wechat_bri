import type { CloudKitFieldValue } from "../cloudkit/databaseClient.js";
/** One embedded attachment reference found in a note's body, in document order. */
export interface AttachmentReference {
    /** UUID that is *also* the CloudKit recordName of a separate `Attachment` record. */
    attachmentIdentifier: string;
    /** Uniform Type Identifier, e.g. "public.jpeg", "com.apple.m4a-audio". */
    typeUti: string;
}
/**
 * Extracts, in document order, every embedded attachment reference from a
 * note's protobuf body: `topotext.String.attributeRun[].attachmentInfo`,
 * when present. Each occurrence corresponds 1:1, in the same order, with one
 * U+FFFC placeholder character in the plain visible text - both walk the
 * same document left-to-right. Verified against real captured audio- and
 * image-attachment notes (dev notes, 2026-07-13/14).
 */
export declare function decodeNoteAttachmentRefs(compressedProtobuf: Buffer): AttachmentReference[];
/**
 * One U+FFFC placeholder's worth of embed, localized by character offset
 * rather than count-correlation (the Step 1 fix from the formatting plan,
 * 2026-07-17): an `attachment` slot has a fully-identified reference; an
 * `unknown` slot is a placeholder whose `attachmentInfo` run was absent or
 * incomplete (its `typeUti` is carried when at least that much was present).
 */
export type EmbedSlot = {
    kind: "attachment";
    ref: AttachmentReference;
} | {
    kind: "unknown";
    typeUti?: string | undefined;
};
/**
 * Maps every U+FFFC placeholder in a note's body to an `EmbedSlot`, in
 * document order, by computing each `attachmentInfo` run's character offset
 * from the attribute-run lengths - no count-correlation assumption.
 *
 * Returns `undefined` when the embed structure defies the model this was
 * verified against - an `attachmentInfo` run that isn't exactly one
 * character long sitting on a U+FFFC, or an attribute-run table that doesn't
 * cover the text. Those notes get the whole-note banner and stay read-only
 * (see `classifyNoteRecord`).
 */
export declare function decodeNoteEmbedSlots(compressedProtobuf: Buffer): EmbedSlot[] | undefined;
/** Apple's plain-text placeholder for any embedded object (attachment,
 * table, drawing, ...) that doesn't have its own literal text representation. */
export declare const OBJECT_REPLACEMENT_CHARACTER = "\uFFFC";
export declare function isImageUti(typeUti: string): boolean;
/** A table is embedded the same way a file attachment is (an `Attachment`
 * record referenced via a field-12 `AttachmentInfo` run), but this UTI
 * marks it as a self-contained mergeable sub-document instead of a file -
 * see `decodeTableRecord.ts`. */
export declare const TABLE_UTI = "com.apple.notes.table";
export declare function isTableUti(typeUti: string): boolean;
export declare function hasAttachmentReference(text: string): boolean;
/** The markdown embed (images) or link (everything else) for one resolved
 * file attachment, pointing at its downloaded file under `attachments/`. */
export declare function formatAttachmentMarkdown(ref: AttachmentReference, relativeFile: string): string;
/**
 * Replaces each U+FFFC placeholder in `bodyText`, in order, with the
 * corresponding entry of `replacements` - one per placeholder, same document
 * order. Used directly by callers that mix attachment kinds (e.g. a table
 * alongside a file attachment) and need a different replacement string per
 * placeholder; `renderAttachmentPlaceholders` below is the file-only
 * convenience wrapper most callers want.
 */
export declare function renderPlaceholders(bodyText: string, replacements: readonly (string | undefined)[]): string;
/**
 * Replaces each U+FFFC placeholder in `bodyText`, in order, with a markdown
 * embed (images) or link (everything else) pointing at the corresponding
 * downloaded file under `attachments/`. `refs` and `relativeFiles` must be
 * the same length and in the same document order as the placeholders -
 * callers are expected to have already verified the counts match
 * (see classifyNoteRecord) before calling this.
 */
export declare function renderAttachmentPlaceholders(bodyText: string, refs: readonly AttachmentReference[], relativeFiles: readonly string[]): string;
/** Decodes a Media record's FilenameEncrypted field, falling back to a
 * synthesized name (recordName + a guessed extension) when it's absent -
 * seen as always-present in captures so far, but the field is optional in
 * the schema and nothing guarantees it stays populated. */
export declare function decodeAttachmentFilename(field: CloudKitFieldValue | undefined, recordName: string, typeUti: string): string;
export interface AttachmentAsset {
    downloadURL: string;
    fileChecksum: string;
}
/** Extracts the download URL + checksum out of an ASSETID-typed field
 * (e.g. a Media record's `Asset`, or an Attachment record's
 * `MergeableDataAsset`). */
export declare function parseAssetField(field: CloudKitFieldValue | undefined): AttachmentAsset | undefined;
