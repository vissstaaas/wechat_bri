/**
 * The semantic formatting model between Apple's attribute runs and this
 * project's markdown rendering - Step 2 of the formatting plan (see the
 * Obsidian doc "icloud-notes-sync formatting", dev log 2026-07-18T07:25).
 *
 * `decodeNoteFormat` projects a note's `text + attributeRun` table onto the
 * dimensions this tool renders: paragraph kind (title/heading/subheading/
 * body/monospaced/lists/todo), list nesting depth, blockquote level, todo
 * state, and the inline bold/italic/strikethrough/underline/link spans.
 * Everything else Apple can express (color, emphasis/highlight, superscript,
 * alignment, fonts, per-paragraph uuids...) is deliberately *not* part of
 * the model: those fields render as plain text, stay byte-preserved on
 * untouched runs, and are overlaid back onto rewritten runs by the
 * reconciler - the accepted-limitations decision, 2026-07-17T10:01.
 *
 * Wire values (all confirmed on the 2026-07-17 formatting-evolution capture,
 * dev log 2026-07-17T10:16): style 0=Title 1=Heading 2=Subheading 3=Body
 * (also written explicitly; absent paragraphStyle means Body too) 4=Monospaced
 * 100=bullet list 101=dash list 102=numbered list 103=checklist (with
 * `todo{uuid, done}`); `indent` is list nesting; `fontHints` bit 1=bold
 * bit 2=italic; underline/strikethrough are plain flag fields; `link` covers
 * exactly the linked range.
 */
import { type AttributeRun } from "./gen/topotext_pb.js";
export type ParagraphKind = "title" | "heading" | "subheading" | "body" | "monospaced" | "bulletList" | "dashList" | "numberedList" | "todoList";
export interface InlineStyle {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    /** Link target URL; empty string means "not a link". */
    link: string;
}
export interface InlineSpan extends InlineStyle {
    /** UTF-16 length of the span within the paragraph's text. Spans cover a
     * paragraph's text exactly, in order (their lengths sum to `text.length`). */
    length: number;
}
export interface FormatParagraph {
    kind: ParagraphKind;
    /** List nesting depth (0 = top level). Carried for every kind but only
     * meaningful - and only round-trip-compared - on list kinds. */
    indent: number;
    blockQuoteLevel: number;
    /** Checklist state; only present on `todoList`. */
    done?: boolean;
    /** `startingListItemNumber`; only meaningful on `numberedList` (0 = default). */
    startNumber: number;
    /** Paragraph text, without its trailing newline. */
    text: string;
    spans: InlineSpan[];
    /** UTF-16 offset of `text` within the note's full text. */
    start: number;
}
export type DecodeNoteFormatResult = {
    status: "ok";
    paragraphs: FormatParagraph[];
} | {
    status: "unsupported";
    reason: string;
};
export declare const PLAIN_STYLE: InlineStyle;
export declare function inlineStyleOfRun(run: AttributeRun): InlineStyle;
export declare function inlineStylesEqual(a: InlineStyle, b: InlineStyle): boolean;
/**
 * Splits a note's text into per-line paragraphs and derives each one's
 * paragraph attributes and inline spans from the attribute runs covering it.
 *
 * Paragraph attributes come from the run covering the line's trailing
 * newline (a paragraph's style flows through its newline - confirmed on the
 * wire), falling back to the line's last character for the final,
 * unterminated line. Runs may span multiple lines (Apple merges adjacent
 * equal runs freely) or disagree within one (never observed; the newline's
 * run wins, matching where Apple's own editor anchors paragraph state).
 *
 * The run table may under-cover the text (tolerated: uncovered text is
 * plain Body, same policy as `decodeNoteEmbedSlots`) but must not overshoot
 * it - that means the runs and text disagree structurally, and the note is
 * reported unsupported rather than guessed at.
 */
export declare function decodeNoteFormat(text: string, attributeRuns: readonly AttributeRun[]): DecodeNoteFormatResult;
/** A span in canonical projection form: dash lists collapse into bullet
 * lists; a link whose target is exactly its own covered text collapses to
 * "not a link" (Apple auto-links bare URLs; GFM re-derives them from plain
 * text, and backslash escapes can't suppress that - see `markdownTable.ts` -
 * so bare-URL links round-trip as plain text by design); monospaced
 * paragraphs drop their inline styling entirely (fenced code blocks are
 * lossy inside - decided 2026-07-17T07:47); and the delimiter-notated
 * styles (bold/italic/strikethrough) retreat off whitespace at their edges,
 * because CommonMark's flanking rules make `* text*` not parse as emphasis -
 * styling a boundary space is visually indistinguishable anyway. */
export declare function normalizeSpans(paragraph: FormatParagraph): InlineSpan[];
/**
 * Trailing horizontal whitespace is invisible in Apple Notes and only
 * representable in markdown as `&#x20;` character references, so it is not
 * part of the projection (decided 2026-07-29): non-monospaced paragraphs
 * render, parse, and compare with trailing spaces/tabs removed, and a push
 * whose note carries them actively deletes them from the remote text.
 * Monospaced paragraphs keep theirs - fenced code preserves trailing
 * whitespace natively. Spans shrink to cover exactly the trimmed text.
 */
export declare function trimTrailingWhitespace(paragraph: FormatParagraph): FormatParagraph;
export declare function isListKind(kind: ParagraphKind): boolean;
export declare function projectedKind(kind: ParagraphKind): ParagraphKind;
/**
 * Whether two paragraphs at the same position agree on every dimension this
 * tool renders. The previous paragraph on each side feeds the numbered-list
 * group-start rule: only a group's first item compares its effective start
 * number, since markdown re-derives every later item's number by counting.
 */
export declare function paragraphProjectionsEqual(rawA: FormatParagraph, rawB: FormatParagraph, previousA: FormatParagraph | undefined, previousB: FormatParagraph | undefined): boolean;
/**
 * Whether two decoded formats agree on every dimension this tool renders -
 * the round-trip gate for Step 2 (`parse(render(doc))` must reproduce the
 * model). Compared on the *projection*: dimensions we deliberately don't
 * render (colors, fonts, non-list indents, dash-vs-bullet, bare-URL links,
 * inline styling inside monospaced blocks...) don't participate.
 */
export declare function formatsRoundTripEqual(a: readonly FormatParagraph[], b: readonly FormatParagraph[]): boolean;
