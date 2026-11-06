/**
 * The two-way projection between a note's title and its file name.
 *
 * `filename.ts` sanitizes a title into a *display* name and stops there -
 * fine when the title also lives in the note body, since nothing needs to
 * read it back. Under `--filename-as-title` the file name is the only place
 * the title lives, so the mapping has to be reversible, and it has to
 * survive three filesystems at once:
 *
 *  - **Windows**: `\ / : * ? " < > |` are illegal, a trailing `.` or space
 *    is silently stripped, and the DOS device names (`CON`, `PRN`, `AUX`,
 *    `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`) are reserved even *with* an
 *    extension - `CON.md` is still reserved.
 *  - **macOS**: `/` is illegal and `:` is hostile (the Finder still shows it
 *    as a path separator in places).
 *  - **Obsidian**, which is the point of the mode: `#`, `^`, `[` and `]` are
 *    rejected in file names because they're wikilink syntax.
 *
 * ## Homoglyphs, not escapes
 *
 * Illegal characters map to visually-near Unicode characters that are legal
 * everywhere (`/` -> U+2044 FRACTION SLASH, and so on), the same device
 * rclone and Bear use. Percent-encoding was rejected because this name is
 * human-facing text in Obsidian's sidebar: `My %2F Note` reads as a bug,
 * `My ⁄ Note` reads as a title.
 *
 * The substitution is a *read-direction* device. Pull writes the file name
 * and does the mapping; nobody types a homoglyph by hand. The consequence is
 * an asymmetry worth being explicit about: a title containing `/` stays
 * readable and stays preserved, but a user cannot *introduce* one by
 * renaming a file, because their filesystem won't let them type it.
 *
 * A title that already contains a homoglyph round-trips wrong (it would
 * decode into the ASCII character it stands for), so those are escaped on
 * the way out - see `ESCAPE`.
 *
 * ## When the file name isn't enough
 *
 * Some titles can't be carried by a file name at all - too long, a leading
 * `.`, a reserved device name. `titleIsRepresentable` identifies them, and
 * the caller records the real title in `apple-note-title` frontmatter
 * instead.
 *
 * Trailing whitespace is the deliberate exception to "unrepresentable means
 * frontmatter": the name carries the *trimmed* spelling and the difference
 * counts as no difference at all - see `carriedTitleSpelling`.
 *
 * The key says "the title this file's name doesn't carry", which is not
 * quite the same as "a title no name *could* carry". Both `pull` (writing
 * one) and `push` (reading one) treat it as outranking the name, so it is
 * also how a user asks for a new title their file name can't express: they
 * write the key, `push` sends the retitle, and `pull` renames the file and
 * clears the key again if the new title turns out to be representable after
 * all. Outside that round trip the key stays absent, which is what keeps it
 * from becoming a second source of truth for titles a name holds fine.
 */
/**
 * How long a title may be before the file name can't hold it. Well under the
 * 255-*byte* limit every mainstream filesystem imposes, since a UTF-8 title
 * can spend up to four bytes per character and the ".md" extension and any
 * " 2" uniquifier suffix have to fit too.
 */
export declare const MAX_TITLE_LENGTH = 60;
/** Encodes a title into a file-name stem that is legal on macOS, Windows and
 * Linux, and acceptable to Obsidian. Reversible via `decodeTitleStem`. */
export declare function encodeTitleStem(title: string): string;
/** Recovers a title from a file-name stem produced by `encodeTitleStem`. */
export declare function decodeTitleStem(stem: string): string;
/**
 * Whether a file name can carry this title on its own. False means the
 * caller must record the title in `apple-note-title` frontmatter, because
 * the name it can write is a lossy stand-in.
 *
 * Note what is *not* here: illegal characters. Homoglyph substitution makes
 * those representable, which is most of why the frontmatter key stays rare.
 */
export declare function titleIsRepresentable(title: string): boolean;
/** Why a title can't be carried by a file name, or undefined when it can.
 * Exported for the pull report, so a note that gains an `apple-note-title`
 * can say why. */
export declare function representabilityProblem(title: string): string | undefined;
/**
 * The spelling of a title that its file name carries: trailing whitespace
 * dropped, everything else exact.
 *
 * A trailing space is real title content in Apple Notes (nothing there ever
 * strips it) but poison in a file name: Windows silently drops it, users can
 * neither see nor retype it, and an Obsidian rename would shed it without
 * anyone deciding to. So the name holds the trimmed spelling, and the
 * difference is treated as *no difference* everywhere a name is read back
 * against a title - with the remote spelling winning, so a push never
 * "corrects" a title nobody touched (see `prepareRetitle`'s equivalence
 * check). Deliberately stripping the whitespace remains expressible, through
 * `apple-note-title`, whose comparison stays exact.
 */
export declare function carriedTitleSpelling(title: string): string;
