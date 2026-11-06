/**
 * Read-side markdown renderer for Step 2 of the formatting plan: turns the
 * semantic model `decodeNoteFormat` extracts from a note into the markdown
 * written to the local file (before embed placeholders are substituted -
 * U+FFFC characters pass through as ordinary text).
 *
 * The renderer is *line-oriented*: Apple's text model is one paragraph per
 * newline-terminated line, empty paragraphs (including consecutive ones) are
 * real content, and `remark-stringify` cannot represent those - it joins
 * block nodes with exactly one blank line. So this module owns the file's
 * newline skeleton itself (one file line per note paragraph; blank file
 * lines are real empty paragraphs; blocks are joined with a single "\n",
 * never a blank line), and delegates everything markdown-*syntactic* -
 * heading/list/checkbox/fence notation, inline emphasis, and especially
 * escaping - to mdast + `remark-stringify`, per the no-hand-rolled-markdown
 * ground rule (2026-07-16). See the design entry, dev log 2026-07-18T07:25.
 *
 * The write-side parser (`parseNoteMarkdown.ts`) reverses this by walking
 * remark-parse's tree with source positions; `classifyNoteRecord` runs the
 * full render→parse round trip on every note and refuses to mark a note
 * publishable when the projection doesn't survive (e.g. CommonMark
 * adjacency artifacts like a body line directly above a `5.`-numbered list).
 *
 * The one place this module overrides `remark-stringify`'s escaping is where
 * the escape would be *correct markdown but wrong for the reader*: bare URLs,
 * the punctuation GFM autolink literals make ambiguous (see
 * `findAutolinkEscapeRanges`), and the Obsidian notation a vault is full of
 * (see `findObsidianRawRanges`). Those are emitted as raw `html` nodes, and
 * the result is re-parsed here before it is kept - `renderNoteMarkdown` falls
 * back to plain `remark-stringify` escaping for the whole note otherwise, so
 * the friendlier spelling can never cost fidelity.
 */
import type { PhrasingContent } from "mdast";
import { type FormatParagraph } from "./noteFormat.js";
/**
 * Which of the friendlier-but-optional unescaping rules a render pass may
 * use. Bare URLs (`findRawUrlRanges`) are not in here: they are unconditional,
 * because they are what this renderer emitted before any of this existed.
 */
export interface RawSpelling {
    /** Obsidian's own notation - see `findObsidianRawRanges`. */
    obsidian: boolean;
    /** Punctuation escaped only against GFM autolink literals - see
     * `findAutolinkEscapeRanges`. */
    autolink: boolean;
}
/** No optional rule at all: the escaping `remark-stringify` chose on its
 * own, and the fallback every caller ends at. */
export declare const CONSERVATIVE_SPELLING: RawSpelling;
/**
 * The spellings worth *trying* for these lines, nicest first: only the rules
 * that would actually change something, and each combination of them, so a
 * line that defeats one rule doesn't cost the reader the other. The
 * conservative spelling is the caller's fallback and is not listed.
 */
export declare function spellingCandidates(lines: Iterable<string>): RawSpelling[];
/**
 * Renders the note, preferring the friendliest spelling (see
 * `spellingCandidates`) that is *provably* the same document.
 *
 * The unescaping rules below are read off CommonMark's own construct
 * definitions, but reading a spec is not the same as being right, and the
 * cost of being wrong would be a note that stops round-tripping - which
 * `classifyNoteRecord` turns into a read-only note. So the preference is
 * checked rather than trusted: render it, parse it back, and keep it only if
 * the projection survives exactly. Anything else falls back to the next
 * spelling down, and ultimately to the escaping `remark-stringify` chose on
 * its own, which is what this renderer emitted before any friendlier spelling
 * was considered at all.
 *
 * That makes the whole feature a strict improvement by construction: a
 * friendlier spelling can never be *worse* than the conservative one, only
 * equal or nicer to read. (When even the conservative rendering fails to
 * round-trip, the note is refused upstream and this output is discarded, so
 * the fallback costs nothing there either.)
 */
export declare function renderNoteMarkdown(rawParagraphs: readonly FormatParagraph[]): string;
/** URL-, autolink- and Obsidian-aware plain-text phrasing for single-line
 * contexts where end-of-string is a safe boundary (table cells: what follows
 * is `<br>`, `|` notation, or nothing - none of which an autolink literal can
 * swallow). `renderMarkdownTable` owns the same choice among spellings this
 * module's `renderNoteMarkdown` makes, which is why `spelling` is its
 * caller's to pass. */
export declare function textPhrasing(value: string, spelling: RawSpelling): PhrasingContent[];
