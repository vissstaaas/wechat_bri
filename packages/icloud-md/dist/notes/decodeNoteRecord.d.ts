import type { CloudKitRecord } from "../cloudkit/databaseClient.js";
import type { TitleMode } from "./cloneState.js";
import { type AttachmentReference, type EmbedSlot } from "./noteAttachments.js";
import { type FormatParagraph } from "./noteFormat.js";
export type OkNoteDecodeResult = {
    status: "ok";
    title: string;
    /** The note's actual first line - what a filename-as-title vault names the
     * file after. Distinct from `title`, which is Apple's truncated, cosmetic
     * display metadata. */
    titleLine: string;
    /** The note's plain visible text - what the CRDT document stores, and
     * what push's text splice operates on. */
    bodyText: string;
    /** The note rendered as markdown (Step 2 of the formatting plan), with
     * U+FFFC placeholders still in place for `resolveNoteAttachments` to
     * substitute. Falls back to `bodyText` verbatim when `publishable` is
     * false - an unrenderable note keeps today's plain-text file shape. */
    markdownText: string;
    /** The decoded formatting model behind `markdownText`; undefined exactly
     * when the fallback above applies. Always the *whole* note, including its
     * title paragraph, even when `titleStripped` says `markdownText` omits it -
     * push needs the original paragraph to put back. */
    format: FormatParagraph[] | undefined;
    /**
     * Whether `markdownText` omits the note's title paragraph, because this
     * vault carries titles in file names. False in an in-body vault, and also
     * false for the individual notes a filename-as-title vault can't strip
     * (a title paragraph containing an embed placeholder) - so callers must
     * read this rather than assuming from the vault's mode.
     */
    titleStripped?: boolean;
    /** One entry per U+FFFC placeholder in `bodyText`, in document order -
     * see `decodeNoteEmbedSlots`. Empty when the embed structure couldn't be
     * mapped (there are no trustworthy slots). */
    embedSlots: EmbedSlot[];
    /** The fully-identified references among `embedSlots`, in the same
     * order - what attachment resolution and the table write path consume. */
    attachments: AttachmentReference[];
    /** False when this note contains content we can't safely push - see
     * the Safety Guarantee Audit dev notes. `push` always re-derives this
     * itself from a fresh record fetch; it's the authoritative gate.
     * Since Step 1 of the formatting plan (2026-07-17), an embed we can't
     * *render* no longer clears this - such notes carry inline markers and
     * stay pushable under the marker-survival policy. A structure we can't
     * *map* (no trustworthy slots) still refuses, and since Step 2 so does
     * formatting that doesn't survive the markdown round trip (unknown
     * paragraph styles, or renderings CommonMark can't reproduce). */
    publishable: boolean;
    unpublishableReason?: string | undefined;
};
/**
 * The two unsyncable reasons differ in what they say about the *note*:
 * "undecodable" means the body bytes are present but don't parse with this
 * tool's model - a durable fact about the record. "missing-body" means the
 * record arrived without `TextDataEncrypted` at all, which is a fact about
 * the *delivery* (shared-zone listings omit bodies, and a per-record lookup
 * can fail transiently) - pull must never untrack a note over it.
 */
export type NoteDecodeResult = {
    status: "deleted";
} | {
    status: "unsyncable";
    reason: "undecodable" | "missing-body";
} | OkNoteDecodeResult;
export interface ClassifyNoteOptions {
    /**
     * "filename": the vault carries note titles in file names, so
     * `markdownText` must exclude the note's title paragraph. The round-trip
     * gate then runs against that *stripped* projection rather than the whole
     * note - what reaches the file is what has to survive re-parsing, and
     * removing the first paragraph can change how what follows parses (a body
     * beginning `5.` being the classic case).
     */
    titleMode?: TitleMode;
}
/** Shared skip/decode rules used by `clone`, `pull`, and `push` so they can't drift apart. */
export declare function classifyNoteRecord(record: CloudKitRecord, options?: ClassifyNoteOptions): NoteDecodeResult;
