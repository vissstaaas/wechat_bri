import type { SyncNotice } from "../progress.js";
import { type CloudKitRecord } from "../cloudkit/databaseClient.js";
import { type CloneState, type CloneStateNoteEntry, type TitleMode } from "../notes/cloneState.js";
import { type NoteDecodeResult } from "../notes/decodeNoteRecord.js";
import { type PlanEntry, type SerializedPlanEntry } from "../notes/pushPlan.js";
import { type FormatParagraph } from "../notes/noteFormat.js";
/**
 * Why an edit to this tracked shared note can't be pushed, or undefined
 * when it can. Notes *inside* a shared folder are editable when the share's
 * stored permission allows it (unknown permission - e.g. state written
 * before the permission field existed - is attempted and left to the
 * server, whose rejection is benign); individually-shared notes loose in a
 * sharer's home stay read-only - probably the same wire shape, but unproven,
 * and their per-note share permission isn't tracked. Exported for `revert`,
 * which is the same kind of remote write and applies the same policy.
 */
export declare function sharedNoteWriteRefusal(state: CloneState, entry: CloneStateNoteEntry): string | undefined;
export interface PushOptions {
    /** Report what would be pushed without sending anything or touching state. */
    dryRun?: boolean;
    /** Routes any headless-recovery login status messages; defaults to staying silent (see `resolveFolderAccount`). */
    onLoginStatus?: (message: string) => void;
}
/** A planned entry plus (for a real, non-dry-run push) what actually
 * happened when it executed - `outcome` is absent for a dry run, since
 * nothing executes, and absent for a plan entry with no `execute` (already
 * refused/conflicting at plan time). */
export interface PushEntryResult extends SerializedPlanEntry {
    outcome?: ExecuteOutcome;
}
export interface PushResult {
    dryRun: boolean;
    /** Count of entries whose `resolution` was "ready" and whose `execute`
     * reported success - absent for a dry run. */
    pushed?: number;
    entries: PushEntryResult[];
    /** Tracked notes the plan left untouched - the "N other notes match the
     * last pull." figure on the dry-run preview screen. */
    unchanged: number;
    /** Plan-level warnings that aren't about one entry - see
     * `BuildPushPlanResult.notices`. */
    notices: SyncNotice[];
}
interface PushSummary {
    conflicts: string[];
    refused: string[];
}
type OkNoteRecordResult = Extract<NoteDecodeResult, {
    status: "ok";
}>;
/** What actually happened when an `ExecutablePlanEntry.execute` ran: whether
 * the write succeeded, and a human-readable description of the outcome (a
 * success message, or the server's rejection detail) - the CLI layer renders
 * this rather than `execute` printing it directly, so `push` stays usable as
 * a library and `--json` can report it structurally. */
export interface ExecuteOutcome {
    succeeded: boolean;
    message: string;
}
/** A `PlanEntry` plus (for anything `buildPushPlan` can actually act on) the
 * closure that does so. `status` only ever reads the `PlanEntry` fields;
 * `push` additionally invokes `execute` for every entry that has one. The
 * closure's return value is the *actual* outcome (a live write can still be
 * rejected after planning said "ready") - callers must use it rather than
 * the entry's `resolution` to decide whether something genuinely happened. */
export interface ExecutablePlanEntry extends PlanEntry {
    execute?: () => Promise<ExecuteOutcome>;
}
export interface BuildPushPlanResult {
    state: CloneState;
    entries: ExecutablePlanEntry[];
    /** Things worth telling the user that aren't about one plan entry - e.g. a
     * file carrying an id from some other vault, which pushes fine as a new
     * note but shouldn't do so silently. */
    notices: SyncNotice[];
}
/**
 * Classifies every locally-relevant file into a create/update/delete plan
 * entry, running every live (network) check the way `push --dry-run` always
 * has - staleness, round-trip, attachment safety - without submitting any
 * write. Shared by `runPush` (which additionally executes the `ready`
 * entries) and `runStatus` (which only renders), so the two can't drift
 * apart - see the "Push becomes the full reconciler" project notes.
 *
 * Login/network access is skipped entirely when there's nothing that needs
 * it (no tracked note is missing, modified, or asking for a new title via
 * `apple-note-title`, and no untracked file passed the local creation
 * gates). A title request needs the network even when the body is clean:
 * whether it differs from the note's current title is only answerable
 * against the live record.
 */
export declare function buildPushPlan(targetDir: string, options?: {
    onLoginStatus?: ((message: string) => void) | undefined;
}): Promise<BuildPushPlanResult>;
/**
 * The remote-changed update path: a real 3-way merge of the remote text into
 * the local edit, using the same machinery `pull` does, run during planning
 * so `status` and `push --dry-run` show the merged reality (see the "status
 * converges with push --dry-run" project notes).
 *
 * State discipline (established by the 2026-07-29 device-in-the-loop
 * experiments, vault dev log): the base copy must always hold the *remote*
 * text at the recorded recordChangeTag - it is the merge ancestor for
 * everything that follows. Writing the merged text instead made the merged
 * file compare "clean", so the promised "re-run push to upload" found
 * nothing to push, and the next merge then read the stranded local edit as
 * a deliberate remote revert and silently deleted it.
 */
export declare function planRemoteChangedMerge(targetDir: string, state: CloneState, recordName: string, entry: CloneStateNoteEntry, frontmatter: string, localText: string, remote: {
    remoteText: string;
    remoteTag: string;
}): Promise<ExecutablePlanEntry>;
/**
 * Uploads locally edited notes back to iCloud, guarded three ways (per the
 * README's Phase 3 plan):
 *
 *  1. Staleness: a note whose remote recordChangeTag moved past the last
 *     clone/pull baseline is reported as a conflict, never overwritten -
 *     run `pull` (which merges) first. The server enforces the same check
 *     again at write time via the tag we send.
 *  2. Round-trip: the current remote document must re-encode byte-for-byte
 *     from our parsed model before we trust ourselves to edit it; anything
 *     we don't fully understand stays read-only.
 *  3. Verification: the rebuilt document is decoded again and must yield
 *     exactly the intended content before it's uploaded.
 *
 * As of the "full reconciler" work, `push` also creates a note for any
 * untracked top-level `.md` file, and deletes the remote note for any
 * tracked file that's gone missing locally (moving it to Recently Deleted,
 * exactly like Apple's own delete) - the everyday workflow is now "edit,
 * add, or remove files, run push", with `delete <file>` staying around as a
 * fast, explicit single-file escape hatch (and `delete --hard` for
 * permanent deletion). Run `status` first to preview exactly what a push
 * will do (including anything it would refuse) before running it for real.
 */
export declare function runPush(targetDir: string, options?: PushOptions): Promise<PushResult>;
/**
 * Builds the note-text payload that carries a renamed file's new title.
 *
 * Only the title paragraph changes: the body is taken from the *remote*
 * record verbatim, not from the renamed file. A move pair has never pushed
 * the file's contents (an edit made in the same breath as a rename lands on
 * the next push, once the note is tracked at its new path), and keeping that
 * true here means a retitle is the single smallest edit that can express
 * itself - which is also what keeps it clear of every U+FFFC placeholder in
 * the body.
 *
 * `retitle` comes back undefined when the note already has this title, which
 * is how renaming `Foo 2.md` (pull's collision spelling of a note genuinely
 * titled "Foo") back to `Foo.md` resolves: the local name catches up, and
 * nothing is sent.
 */
export declare function prepareRetitle(record: CloudKitRecord, pair: {
    entry: CloneStateNoteEntry;
    toFile: string;
    newTitle?: string | undefined;
}, replicaId: Uint8Array, titleMode: TitleMode): {
    ok: true;
    retitle: {
        payloadBase64: string;
        plainText: string;
    } | undefined;
} | {
    ok: false;
    resolution: "refused" | "conflict";
    reason: string;
};
/**
 * The title a local file expresses, in a vault where the file name is the
 * title: what its name spells, unless it carries an `apple-note-title`,
 * which outranks the name.
 *
 * The precedence is not a preference - it's the only reading that isn't
 * lossy. A file is called "Untitled.md" precisely *because* its title
 * wouldn't fit in a name, so taking the name at face value would retitle the
 * note to "Untitled". Used for both a rename (which retitles) and a create
 * (which titles a new note); a copy of an Untitled note therefore keeps the
 * title it was copied from rather than becoming "Untitled" itself.
 */
export declare function titleExpressedByFile(file: string, recordedTitles: ReadonlyMap<string, string>): string;
/**
 * Puts a note's title paragraph back in front of a body-only local parse,
 * for the vault shape that keeps titles in file names. A no-op - the parse
 * handed straight back - whenever the working file already carries its own
 * title, which covers every in-body vault and the individual notes a
 * filename-as-title vault can't strip.
 *
 * The title comes from the live remote record, style and inline runs intact,
 * and deliberately *not* from the file name. A file name is a lossy record
 * of the title it was derived from - pull's collision uniquifier turns a
 * second "Foo" into `Foo 2.md`, and a title too long for a name will land in
 * `apple-note-title` - so re-deriving one here would rewrite the titles of
 * notes nobody touched. The file name only becomes authoritative when the
 * user *changes* it, and that arrives as a move pair rather than as an
 * update to the file in place.
 *
 * `requestedTitle` is the exception that proves that rule: an
 * `apple-note-title` the file states outright. It is not a re-derivation and
 * carries no loss - it's an exact string the user wrote - so it outranks the
 * record. Applied only when it actually differs from the note's current
 * title: an equal one is the ordinary record of an unrepresentable title,
 * and rebuilding the paragraph for it would restyle a title nobody touched.
 *
 * Nothing here renames the file to match. That is pull's job, on the next
 * pull, through exactly the path a retitle made on another device takes -
 * `renameForRemoteTitle`, which honours `--defer-renames` and clears the
 * frontmatter key once the name can carry the title itself.
 */
export declare function restoreStrippedTitle(classified: OkNoteRecordResult, parsed: {
    text: string;
    paragraphs: FormatParagraph[];
}, entry: CloneStateNoteEntry, summary: PushSummary, requestedTitle?: string | undefined): {
    text: string;
    paragraphs: FormatParagraph[];
} | undefined;
export {};
