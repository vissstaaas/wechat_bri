import path from "node:path";
import { AmbiguousTrackedFileError, UnknownVersionSnapshotError, UntrackedFileError } from "../errors.js";
import { listVersions } from "./versionHistory.js";
/**
 * Matches a user-supplied file argument against tracked entries' vault-root-
 * relative `file` paths, git-style: the argument resolves against the
 * current directory first (so `icloud-md delete Pie.md` works from inside
 * `Recipes/`, and `../Work/Standup.md` works from a sibling), with a
 * unique-basename fallback so a bare name still resolves from anywhere when
 * it's unambiguous. Returns undefined when nothing matches; throws
 * AmbiguousTrackedFileError when a bare name matches several entries.
 */
export function matchTrackedFile(entries, fileArg, targetDir, cwd = process.cwd()) {
    const rootRelative = vaultRelativePath(fileArg, targetDir, cwd);
    if (rootRelative !== undefined) {
        const exact = Object.entries(entries).find(([, entry]) => entry.file === rootRelative);
        if (exact) {
            return exact;
        }
    }
    const base = path.basename(fileArg);
    const byBasename = Object.entries(entries).filter(([, entry]) => path.posix.basename(entry.file) === base);
    if (byBasename.length > 1) {
        throw new AmbiguousTrackedFileError(base, byBasename.map(([, entry]) => entry.file));
    }
    return byBasename[0];
}
/** A file argument resolved against the current directory, re-expressed
 * relative to the vault root (POSIX form) - or undefined when it points
 * outside the vault entirely. */
function vaultRelativePath(fileArg, targetDir, cwd) {
    const relative = path.relative(path.resolve(targetDir), path.resolve(cwd, fileArg));
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        return undefined;
    }
    return relative.split(path.sep).join("/");
}
/** Resolves a file argument to its tracked note - see `matchTrackedFile`
 * for the resolution rules. Throws `UntrackedFileError` if it doesn't match
 * a tracked note. */
export function resolveTrackedNote(state, fileArg, targetDir) {
    const match = matchTrackedFile(state.notes, fileArg, targetDir);
    if (!match) {
        throw new UntrackedFileError(fileArg, targetDir);
    }
    const [recordName, entry] = match;
    return { recordName, entry };
}
/** Every recordName whose version history belongs to this note: its own
 * Note record, plus any table attachments currently associated with it. */
export function historyRecordNames(state, recordName) {
    const tableRecordNames = Object.entries(state.tableAttachments ?? {})
        .filter(([, entry]) => entry.noteRecordName === recordName)
        .map(([tableRecordName]) => tableRecordName);
    return [recordName, ...tableRecordNames];
}
/** Finds a snapshot by id across a set of recordNames (a note's own history
 * plus its table attachments'), for `diff`/`revert`. Throws
 * `UnknownVersionSnapshotError` if no recorded snapshot matches - `fileArg`
 * is only used for that error's message. */
export async function findSnapshotById(targetDir, recordNames, id, fileArg) {
    for (const recordName of recordNames) {
        const match = (await listVersions(targetDir, recordName)).find((snapshot) => snapshot.id === id);
        if (match) {
            return match;
        }
    }
    throw new UnknownVersionSnapshotError(id, fileArg);
}
//# sourceMappingURL=trackedFile.js.map