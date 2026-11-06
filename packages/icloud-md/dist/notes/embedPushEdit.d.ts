/**
 * Pure logic behind `push`'s embed-bearing note path (Step 1 of the
 * formatting plan, 2026-07-17): matches a note's embed slots (see
 * `decodeNoteEmbedSlots`) against their local representations - inline embed
 * markers and rendered markdown table blocks - and reconstructs the "true"
 * body text (U+FFFC placeholders) that `TextDataEncrypted` actually stores.
 *
 * The policy: every marker must survive **verbatim**, in document order.
 * Edits around markers are fine; a deleted, edited, duplicated, or
 * reordered marker refuses the push with a reason naming what went wrong.
 * The network/fs orchestration lives in `src/commands/push.ts`.
 */
import { type MarkdownTableBlock } from "./markdownTable.js";
import { type AttachmentReference, type EmbedSlot } from "./noteAttachments.js";
/** One table slot matched to its local markdown block, in document order -
 * what `push`'s table-attachment update loop consumes. */
export interface MatchedTableBlock {
    ref: AttachmentReference;
    block: MarkdownTableBlock;
}
export type EmbedRepresentationPlan = {
    ok: true;
    /** `localText` with every marker and table block replaced by U+FFFC -
     * the desired body text, comparable against the remote note's own. */
    reconstructedBodyText: string;
    /** Table slots in document order (may be empty). */
    tables: MatchedTableBlock[];
} | {
    ok: false;
    reason: string;
};
/**
 * Locates each embed slot's local representation and verifies the
 * marker-survival policy. A slot is marker-represented when it's `unknown`
 * (pull always wrote a marker) or when its attachment id appears among the
 * local markers (pull couldn't render it - an undecodable table, an
 * unresolvable file chain, an unsupported kind). An identified table slot
 * without a marker expects a markdown table block; an id found in
 * `trackedFileAttachmentIds` (attachment records that resolved to downloaded
 * files at pull time, from `state.attachments`) keeps the existing
 * file-attachment refusal - there's no file write path yet.
 */
export declare function planEmbedRepresentations(localText: string, slots: readonly EmbedSlot[], trackedFileAttachmentIds: ReadonlySet<string>): EmbedRepresentationPlan;
