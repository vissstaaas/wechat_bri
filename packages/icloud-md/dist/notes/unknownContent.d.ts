/**
 * Shared wording/detection for content this tool couldn't parse.
 *
 * Two distinct surfaces, with different consequences:
 *
 *  - The whole-note **banner** (a markdown admonition prepended to the body):
 *    the note's embed structure itself defied this tool's model (see
 *    `decodeNoteEmbedSlots`), so nothing about it can be localized. A note
 *    carrying the banner is never pushable.
 *  - An inline **embed marker** (`<apple-embed …>label</apple-embed>`):
 *    one specific embedded object couldn't be rendered, but its position -
 *    and usually its identity - is precisely known. Marker-bearing notes ARE
 *    pushable: `push` requires every marker to survive verbatim in document
 *    order (each maps back to its U+FFFC placeholder), and refuses when one
 *    was deleted, edited, duplicated, or reordered. See `embedPushEdit.ts`.
 */
/** Prepended to a note's body when the embed structure couldn't be mapped at
 * all (an `attachmentInfo` run not sitting on a lone U+FFFC placeholder) -
 * see `decodeNoteEmbedSlots`. */
export declare const UNKNOWN_CONTENT_BANNER: string;
/** True if `text` still contains the whole-note banner - used by `push` to
 * refuse fast, before any network round trip. */
export declare function hasUnknownContentMarker(text: string): boolean;
/** What an inline embed marker carries. Both fields optional: an embed whose
 * `attachmentInfo` run was missing or incomplete still gets a marker, just
 * with less identity in it. */
export interface EmbedMarkerContent {
    typeUti?: string | undefined;
    attachmentIdentifier?: string | undefined;
}
/**
 * The inline marker written in place of one embed's U+FFFC placeholder when
 * the embed can't be rendered (unsupported kind, unresolvable record, or no
 * usable `attachmentInfo` at all). Replaces exactly the placeholder
 * character - no added newlines - so reversing it (marker -> U+FFFC)
 * reconstructs the remote text exactly.
 */
export declare function formatEmbedMarker(content: EmbedMarkerContent): string;
export interface ParsedEmbedMarker {
    /** Character range [start, end) of the whole marker in the searched text. */
    start: number;
    end: number;
    /** The exact matched text - `push` compares this verbatim against what
     * `formatEmbedMarker` would produce for the corresponding embed. */
    text: string;
    typeUti: string;
    attachmentIdentifier?: string | undefined;
}
/** Every embed-marker-shaped span in `text`, in document order. Liberal on
 * purpose: anything that looks like a marker is surfaced, and the caller
 * decides whether it exactly matches an expected one (a mangled marker must
 * show up here so `push` can refuse it, not silently pass it through as
 * literal text). */
export declare function parseEmbedMarkers(text: string): ParsedEmbedMarker[];
/** True if `text` contains anything that even starts like an embed marker -
 * used by `push`'s create path (a brand-new note can't carry embeds). */
export declare function hasEmbedMarker(text: string): boolean;
/** Combines the two independent sources of "why is this note unpublishable"
 * into the single reason stored on a note's state entry. `undefined` if both
 * are absent. */
export declare function combineUnpublishableReasons(a: string | undefined, b: string | undefined): string | undefined;
