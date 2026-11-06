import type { CloneStateNoteEntry, TitleMode } from "./cloneState.js";
/**
 * Whether a tracked note's local file still matches its base copy (the last
 * known synced/merged content). "missing" is distinguished from "modified"
 * so callers can treat a vanished file (nothing to lose) differently from a
 * hand-edited one (something to protect - `pull` merges it, `push` uploads
 * it). Shared between `pull` and `push` so the two commands can't disagree
 * about what counts as a local edit.
 */
export type LocalFileState = "clean" | "modified" | "missing";
/**
 * A tracked note's file as it currently sits on disk: its state, and - for
 * anything actually there - the split it was judged on, so a caller that
 * needs the content doesn't read the same file a second time.
 *
 * The envelope is worth having even when the body came back "clean": a
 * frontmatter-only edit is invisible to the comparison below by design, but
 * it isn't nothing. `push` reads `apple-note-title` out of it to find a
 * retitle the body could never express (see `restoreStrippedTitle`).
 */
export type LocalNote = {
    status: "missing";
} | {
    status: "clean" | "modified";
    frontmatter: string;
    body: string;
};
export declare function readLocalNote(targetDir: string, entry: CloneStateNoteEntry, recordName: string, titleMode?: TitleMode): Promise<LocalNote>;
export declare function localFileState(targetDir: string, entry: CloneStateNoteEntry, recordName: string, titleMode?: TitleMode): Promise<LocalFileState>;
