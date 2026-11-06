import type { CloneState, CloneStateNoteEntry } from "./cloneState.js";
import { type VersionSnapshot } from "./versionHistory.js";
export interface TrackedNote {
    recordName: string;
    entry: CloneStateNoteEntry;
}
/**
 * Matches a user-supplied file argument against tracked entries' vault-root-
 * relative `file` paths, git-style: the argument resolves against the
 * current directory first (so `icloud-md delete Pie.md` works from inside
 * `Recipes/`, and `../Work/Standup.md` works from a sibling), with a
 * unique-basename fallback so a bare name still resolves from anywhere when
 * it's unambiguous. Returns undefined when nothing matches; throws
 * AmbiguousTrackedFileError when a bare name matches several entries.
 */
export declare function matchTrackedFile<T extends {
    file: string;
}>(entries: Record<string, T>, fileArg: string, targetDir: string, cwd?: string): [string, T] | undefined;
/** Resolves a file argument to its tracked note - see `matchTrackedFile`
 * for the resolution rules. Throws `UntrackedFileError` if it doesn't match
 * a tracked note. */
export declare function resolveTrackedNote(state: CloneState, fileArg: string, targetDir: string): TrackedNote;
/** Every recordName whose version history belongs to this note: its own
 * Note record, plus any table attachments currently associated with it. */
export declare function historyRecordNames(state: CloneState, recordName: string): string[];
/** Finds a snapshot by id across a set of recordNames (a note's own history
 * plus its table attachments'), for `diff`/`revert`. Throws
 * `UnknownVersionSnapshotError` if no recorded snapshot matches - `fileArg`
 * is only used for that error's message. */
export declare function findSnapshotById(targetDir: string, recordNames: readonly string[], id: string, fileArg: string): Promise<VersionSnapshot>;
