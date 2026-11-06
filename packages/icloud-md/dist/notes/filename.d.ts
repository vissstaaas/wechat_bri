/**
 * The file name for a note, given how this vault carries titles.
 *
 * In-body mode keeps `noteFileName`'s destructive sanitizing: the name is
 * only a display convenience there, since the title also sits in the file.
 * Filename mode uses the reversible projection instead, because the name is
 * the only place the title lives - reversible up to trailing whitespace,
 * which the name drops (see `carriedTitleSpelling`) - and falls back to
 * "Untitled" for a title a name genuinely can't carry, with the real one
 * recorded in `apple-note-title` frontmatter by the caller.
 */
export declare function noteFileNameFor(titleLine: string, titleMode: "in-body" | "filename"): string;
/**
 * The note's real title when a file name can't carry it, for the caller to
 * record in `apple-note-title` frontmatter - and undefined whenever the name
 * is enough, which is nearly always.
 *
 * The exact complement of `noteFileNameFor`'s "Untitled.md" fallback: these
 * two answer the same question ("can the name hold this?") and must never
 * disagree, so they're kept side by side and both defer to
 * `titleIsRepresentable`.
 */
export declare function titleNeedingFrontmatter(titleLine: string, titleMode: "in-body" | "filename"): string | undefined;
/**
 * Whether a file name already carries this title, in a vault where the name
 * *is* the title - either the name the title derives, or one of the
 * uniquified spellings `uniqueFileName` produces when two notes want the
 * same one.
 *
 * The uniquifier is why this can't just be a string comparison. A second
 * note titled "Foo" lands at `Foo 2.md`, whose stem decodes to "Foo 2" - so
 * comparing the decoded name against the title would call every uniquified
 * file a retitle and rename it on every pull, walking it up through "Foo 3",
 * "Foo 4"... The title a name was derived from is not always recoverable
 * from the name; whether the name is *acceptable* for the title always is,
 * and that's the question a rename decision actually asks.
 */
export declare function fileNameCarriesTitle(fileName: string, titleLine: string): boolean;
/**
 * Derives a human-readable file name for a note from its title alone. The
 * CloudKit recordName that used to be suffixed onto every file for
 * uniqueness now lives only in .icloud-md/state.json (keyed by
 * recordName, with a `file` pointer back to disk) - see uniqueFileName for
 * how title collisions are disambiguated instead.
 */
export declare function noteFileName(title: string): string;
/**
 * Resolves a candidate file name against names already claimed in this
 * clone/pull run, appending " 2", " 3", etc. (Finder-style) until it's
 * unique. Needed now that file names are derived from title alone, so two
 * notes titled e.g. "New Note" no longer collide.
 */
export declare function uniqueFileName(fileName: string, usedFileNames: ReadonlySet<string>): string;
