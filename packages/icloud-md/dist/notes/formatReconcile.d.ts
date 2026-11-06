/**
 * The write-side formatting reconciler for Step 2 of the formatting plan:
 * given a note document whose *text* has already been brought to the
 * desired state (`applyTextEdit`), rewrites the attribute runs of every
 * paragraph whose rendered formatting differs from the desired model, and
 * applies the corresponding formatting op to the CRDT layer
 * (`applyFormattingOp`: op-clock bump + substring restamp).
 *
 * Edits are *clone-overlay* (design entry, dev log 2026-07-18T07:25):
 * untouched paragraphs keep their attribute runs verbatim; a changed
 * paragraph's runs are split at paragraph/span boundaries, each piece
 * cloned from its underlying run, and only the fields whose rendered
 * projection actually differs are overlaid. Everything this tool doesn't
 * render - colors, emphasis, fonts on unchanged bold spans, non-list
 * indents, dash-list style values, bare-URL link fields, attachmentInfo,
 * paragraph uuids, protobuf unknown fields - rides along untouched.
 * Comparisons happen in the same normalized projection the round-trip gate
 * uses, so e.g. a bare-URL link (link == its own text) is never "removed"
 * just because markdown represents it as plain text.
 */
import { type NoteDocument } from "./noteDocument.js";
import { type FormatParagraph } from "./noteFormat.js";
export type ReconcileResult = {
    ok: true;
    changed: boolean;
} | {
    ok: false;
    reason: string;
};
/**
 * Reconciles `doc`'s formatting to `desired`. `doc.text` must already equal
 * the desired plain text (same paragraph structure) - the text splice runs
 * first, this second. Returns whether anything changed; refuses (rather
 * than guesses) if the document's current formatting can't be decoded or
 * doesn't line up with the desired paragraphs.
 */
export declare function reconcileNoteFormat(doc: NoteDocument, desired: readonly FormatParagraph[], replicaId: Uint8Array): ReconcileResult;
