/**
 * The markdown side of the table pipeline: rendering a decoded table grid as
 * a GFM pipe table, parsing one back, and locating table-shaped blocks
 * inside a note's full text (a table's rendered markdown is spliced directly
 * into the body text at read time - see `resolveNoteAttachments` - with no
 * other marker separating it from surrounding prose).
 *
 * All parsing and serialization goes through unified/remark (project ground
 * rule, 2026-07-16: no hand-rolled markdown scanning anywhere - see the
 * "Table write engine (1/4)" investigation). The few places below that look
 * at raw lines are structural *guards* on top of what remark already parsed,
 * not parsers: GFM is laxer than the shape this project's own renderer
 * emits (rows may omit their leading/trailing pipes, and a paragraph line
 * directly after a table is lazily absorbed into it as a one-cell row), and
 * `push`'s safety model depends on *not* honoring that laxness - a block
 * that stops matching the strict shape must end there, so the block count
 * cross-check against the note's actual attachments can catch it.
 *
 * Output-format note: `remark-stringify` cannot be configured to reproduce
 * the previous hand-rolled renderer's exact bytes (it emits `| - |`
 * separator rows rather than `| --- |`, pads empty cells with one space
 * rather than two, and backslash-escapes markdown punctuation inside cell
 * text). Every variant parses back to the identical grid, and local-edit
 * detection compares file bytes against the base copy (both written by the
 * same renderer generation) rather than re-rendering, so on-disk files only
 * pick up the new format when a remote change rewrites them anyway - see
 * the dev log entry for this change.
 */
export interface MarkdownTableBlock {
    /** Line index (0-based) of the block's header row. */
    startLine: number;
    /** Line index one past the block's last row. */
    endLine: number;
    grid: string[][];
}
/**
 * Renders the grid, preferring the friendliest spelling of its cells - the
 * Obsidian one (`[[Note]]` rather than `\[\[Note]]`) and the unescaped
 * punctuation GFM autolink literals would otherwise cost (`flow.ts` rather
 * than `flow\.ts`); see `renderNoteMarkdown`'s `spellingCandidates`. Exactly
 * as that renderer does, a spelling is kept only when it is provably the same
 * table: it is parsed back and compared against the conservative rendering. A
 * table's markdown is spliced into the note body *after* the note-level
 * round-trip gate has run, so this is the only check standing behind it.
 */
export declare function renderMarkdownTable(grid: readonly string[][]): string;
/**
 * Parses a single GFM pipe table back into a grid, for `push` to diff the
 * locally-edited markdown against the table's current state. Deliberately
 * narrow: the input must be exactly one strictly-shaped table (every row
 * pipe-delimited, every row matching the header's column count) with nothing
 * but blank lines around it - anything else throws, which `push` treats as
 * "can't safely apply this edit" rather than guessing.
 */
export declare function parseMarkdownTable(markdown: string): string[][];
/**
 * Scans `text` for strictly-shaped GFM pipe-table blocks (the same shape
 * `renderMarkdownTable` produces), in document order. Only root-level tables
 * count - a table nested in a blockquote or list can't be one this project
 * spliced in, and splicing whole lines back out of one would corrupt its
 * container. A block that starts like a table but hits a row with the wrong
 * column count, or a line remark only absorbed via GFM's lax row syntax
 * (no leading/trailing pipes - including prose directly below a table, which
 * GFM lazily swallows as a one-cell row), ends at the last strict row -
 * `push` is expected to cross-check the resulting block count against how
 * many table attachments the note actually has and refuse if they don't
 * match, rather than trust a possibly-spurious match.
 */
export declare function findMarkdownTableBlocks(text: string): MarkdownTableBlock[];
