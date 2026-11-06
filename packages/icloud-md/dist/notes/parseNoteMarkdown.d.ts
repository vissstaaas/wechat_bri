/**
 * Write-side markdown parser for Step 2 of the formatting plan: turns a
 * local file's markdown (after embed markers and table blocks have been
 * extracted and replaced with U+FFFC placeholders) back into the semantic
 * `FormatParagraph` model that `renderNoteMarkdown` renders from.
 *
 * All tokenizing goes through remark (+GFM) - same plugin set as the
 * renderer, so construct recognition and escaping agree. What this module
 * adds on top of the mdast tree is *line bookkeeping* via source positions,
 * because the model is line-oriented while markdown is block-oriented. The
 * tree walk records which paragraph(s) each source line produced (and which
 * lines are pure syntax - code fences, setext underlines); a final sweep
 * emits everything in source-line order, turning every line no construct
 * claimed into a real empty paragraph at its own blockquote depth. That
 * sweep is what preserves Apple's empty paragraphs everywhere they occur -
 * between blocks, inside blockquotes, and *between list items* (remark
 * absorbs a blank line between two lists into one loose list; the sweep
 * puts the empty paragraph back where the source had it).
 *
 * Other line-level rules:
 * - Multi-line paragraph nodes (soft breaks, lazy continuations) split back
 *   into per-line paragraphs: the first line keeps its container's meaning
 *   (list item, quote, ...), continuation lines become Body paragraphs
 *   whose blockquote level is re-derived from the raw line's own `>`
 *   markers - a lazily continued line carries no markers and correctly
 *   lands outside the quote.
 * - GFM autolink literals (bare URLs remark turns into links; backslash
 *   escapes can't suppress it - see `markdownTable.ts`) are *not* link
 *   spans: only bracket/angle syntax is. Apple's own bare-URL links
 *   round-trip as plain text by the same rule (`normalizeSpans`).
 * - Constructs Apple Notes can't express degrade in one of two ways:
 *   inline constructs (inline code, images, ...) contribute their raw
 *   source text literally, like `markdownTable.ts`'s cell fallback; block
 *   constructs (thematic breaks, html blocks, deep headings, ...) refuse
 *   the parse with a precise reason - push surfaces it, and the read-side
 *   round-trip gate never produces them.
 */
import { type FormatParagraph } from "./noteFormat.js";
export type ParseNoteMarkdownResult = {
    status: "ok";
    paragraphs: FormatParagraph[];
    text: string;
} | {
    status: "unsupported";
    reason: string;
};
export declare function parseNoteMarkdown(markdown: string): ParseNoteMarkdownResult;
/** Number of leading `>` blockquote markers on a raw source line (each may
 * be preceded by up to three spaces of indentation, per CommonMark). */
export declare function countQuoteMarkers(rawLine: string): number;
