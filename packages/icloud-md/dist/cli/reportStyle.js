import chalk from "chalk";
/**
 * The one palette every human-readable listing (`status`, `push`, and
 * `pull`) draws from, after paprika-recipes' reporting module:
 * colour says what *kind* of thing happened, consistently everywhere -
 * green for something appearing, yellow for something changing in place,
 * red for something going away, cyan for something relocating.
 *
 * Two outcomes need the reader to act, so they get colours nothing routine
 * uses: magenta for a conflict (resolvable - do something, then retry), and
 * black-on-red for something this tool cannot sync at all - the one status
 * a retry won't change, so it's deliberately the loudest thing on screen.
 *
 * These are the terminal's own palette colours, and deliberately nothing
 * else: they're themed by whoever is reading, so they stay legible against
 * their background by construction. An absolute colour would be a guess
 * about a background we can't see. (The `UNSYNCABLE` background is the same
 * themed red, with the theme's "black" on top of it.)
 */
export const NEW = chalk.green;
export const CHANGED = chalk.yellow;
export const GONE = chalk.red;
export const MOVED = chalk.cyan;
export const NEEDS_ATTENTION = chalk.magenta;
export const UNSYNCABLE = chalk.bgRed.black;
/** De-emphasis for the routine remarks around a listing ("Nothing to
 * push.") - an attribute rather than a colour, so it dims the reader's own
 * foreground instead of replacing it. */
export const QUIET = chalk.dim;
/** The indent every changelist sits at beneath its heading, `git status`-
 * style - shared by the push previews (`status`, `push --dry-run`) and
 * `pull`'s report so the screens read as one family. */
export const LISTING_INDENT = " ".repeat(8);
/**
 * One listing line: the status label coloured and padded to a common
 * column, the subject after it in the terminal's own foreground colour.
 * `width` is the longest label in the listing's label set, so a report
 * reads as a column rather than a ragged list.
 */
export function labelledLine(label, color, width, subject) {
    return `${color(label.padEnd(width))} ${subject}`;
}
/**
 * A remark line belonging to the entry above it, indented to sit under the
 * entry's subject rather than its label. The indent stays outside the
 * colour so a background style (`UNSYNCABLE`) starts at the text.
 */
export function remarkLine(color, width, message) {
    return `${" ".repeat(width + 1)}${color(message)}`;
}
//# sourceMappingURL=reportStyle.js.map