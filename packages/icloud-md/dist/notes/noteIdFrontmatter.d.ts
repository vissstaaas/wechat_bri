/**
 * Reads and writes the `apple-note-id` key inside a note's local-only
 * frontmatter envelope (see `frontmatter.ts` for what that envelope is and
 * why it never reaches iCloud).
 *
 * ## Why the id lives in the file
 *
 * Tracking a note by its *path* means a rename is indistinguishable from a
 * delete plus an unrelated create, which only heuristics can pair back up.
 * Carrying the note's identity in the file makes renames, moves, and
 * rename-plus-edit-in-one-go all resolve exactly. Path tracking stays, but
 * as an index and as the handle for files that no longer exist - not as
 * identity (see the 2026-07-30 dev log).
 *
 * The value is the note's CloudKit `recordName`: a UUID that is genuinely
 * Apple's identifier for that note across every Apple client, which is why
 * the key is `apple-note-id` rather than something tool-specific. Two
 * caveats worth knowing:
 *
 *  - Notes this tool *creates* get a client-generated recordName, so it's an
 *    id in Apple's namespace that Apple accepted, not one Apple issued.
 *  - recordNames are unique within a CloudKit *zone*, not globally. A shared
 *    note lives in the sharer's zone. `state.notes` already keys by bare
 *    recordName across all zones, so this inherits an assumption the vault
 *    already makes - but it must not be documented as globally unique.
 *
 * ## Why a real YAML parser
 *
 * We are not the only writer of this block: Obsidian, Templater, Dataview
 * and linter plugins all touch it, and YAML has several ways to spell the
 * same string (plain, single-quoted, double-quoted, literal `|`, folded
 * `>`). A line-level scan also can't tell a top-level key from one nested
 * under `aliases:` or one sitting inside a block scalar's text. So this
 * module uses `yaml`'s document API - specifically the one that preserves
 * comments, key order, and quoting style, since reformatting a user's
 * frontmatter every time we stamp an id would be its own kind of damage.
 *
 * `frontmatter.ts` promises the envelope round-trips byte-for-byte, and
 * re-serializing through YAML can't guarantee that in every edge case. The
 * reconciliation is that this module only ever *writes* when something
 * actually needs to change: `setNoteId` returns the envelope untouched when
 * the id is already correct, which is the overwhelmingly common path.
 */
/** The frontmatter key carrying a note's CloudKit recordName. */
export declare const NOTE_ID_KEY = "apple-note-id";
/**
 * The frontmatter key carrying a note's real title, for the rare note whose
 * title a file name genuinely can't hold (`titleIsRepresentable` decides;
 * homoglyph substitution keeps the list short). Such a note is filed as
 * `Untitled.md` and this key is the only record of what it's actually
 * called.
 *
 * Deliberately absent for every other note. Duplicating a representable
 * title into frontmatter would create a second source of truth for it, and
 * then a disagreement between the two would have no correct resolution.
 */
export declare const NOTE_TITLE_KEY = "apple-note-title";
export declare function isNoteId(value: string): boolean;
/**
 * The note id recorded in a frontmatter envelope, or undefined when there
 * isn't a usable one.
 *
 * Deliberately total: unparseable YAML, a missing key, a non-scalar value,
 * and a value that isn't UUID-shaped all read as "no id" rather than an
 * error. A file with a broken frontmatter block is a file someone is
 * part-way through editing, and it must degrade to path matching rather
 * than fail a whole push.
 */
export declare function readNoteId(frontmatter: string): string | undefined;
/**
 * Returns `frontmatter` with `apple-note-id` set to `id`, creating the
 * envelope if the file had none.
 *
 * Returns the input unchanged when the id is already correct - that's what
 * keeps the byte-for-byte round-trip true for every file we aren't actually
 * changing (see the module comment).
 */
export declare function setNoteId(frontmatter: string, id: string): string;
/**
 * Removes `apple-note-id` from an envelope - used when a file turns out to
 * be a copy of another note and has to be re-stamped with an id of its own.
 * Leaves the rest of the block (and the file's own formatting) alone.
 */
export declare function clearNoteId(frontmatter: string): string;
/**
 * The real title recorded in a frontmatter envelope, or undefined when there
 * isn't one. Total in the same way `readNoteId` is: broken YAML, a missing
 * key, a non-string value and an empty string all read as "no recorded
 * title", so the caller falls back to the file name.
 */
export declare function readNoteTitle(frontmatter: string): string | undefined;
/** Returns `frontmatter` with `apple-note-title` set, creating the envelope
 * if there was none. Unchanged when it already says exactly this. */
export declare function setNoteTitle(frontmatter: string, title: string): string;
/**
 * Removes `apple-note-title` - what keeps the key rare. A note retitled
 * remotely to something a file name *can* hold gets its real name back and
 * must not keep a stale copy of the old title in frontmatter.
 */
export declare function clearNoteTitle(frontmatter: string): string;
/**
 * Assembles the text of a note's working file: the body, under an envelope
 * carrying its id. The single place `clone` and `pull` go through, so the two
 * can't disagree about whether a freshly written file is stamped.
 *
 * Every note carries its id - there is no mode in which one doesn't. Making
 * it optional bought no correctness (nothing about the sync needs the id
 * absent) and cost a second pairing path through `push` forever, so the
 * option was removed in favour of one shape.
 *
 * `frontmatter` is whatever envelope the file already had (empty for a file
 * being created), so a user's own keys survive every rewrite.
 *
 * `unrepresentableTitle` is the note's real title when the file name can't
 * carry it (see `NOTE_TITLE_KEY`), and undefined whenever the name is
 * enough - passing undefined actively *removes* a stale key, which is what
 * keeps the two in step as a note is retitled back and forth across the
 * representable boundary.
 */
export declare function composeNoteFile(frontmatter: string, body: string, recordName: string, unrepresentableTitle?: string | undefined): string;
