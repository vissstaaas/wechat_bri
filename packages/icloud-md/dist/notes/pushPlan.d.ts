/** Which of the ways a local file can differ from `state.json` this entry
 * represents. "move" is a locally-relocated tracked note (detected by
 * pairing a missing tracked file with an untracked one - see push.ts).
 * "rename" is the odd one out: not something push will do, but something the
 * reader still has to - a rename `pull --defer-renames` handed off and
 * nobody has performed. */
export type PlanEntryKind = "create" | "createFolder" | "update" | "delete" | "move" | "rename";
/**
 * "noop" covers both a clean tracked file (nothing to do) and a "modified"
 * one whose only difference from the base copy turned out not to matter
 * (e.g. a table diff that resolved to no server-side change) - in both
 * cases there's genuinely nothing to show the user, matching how `git
 * status` omits a file with no effective diff.
 */
export type PlanResolution = "ready" | "refused" | "conflict" | "noop";
export interface PlanEntry {
    kind: PlanEntryKind;
    file: string;
    resolution: PlanResolution;
    /** Required for "refused"/"conflict"; ignored otherwise. */
    reason?: string;
    /** kind "createFolder" only: `file` is a directory path rather than a
     * note, and this is the Notes folder title it will be given. */
    folderTitle?: string;
    /** kind "move" only: the vault-root-relative path the note was tracked
     * at before the local move. */
    previousFile?: string;
    /** kind "rename" only: the vault-root-relative path this file is supposed
     * to be renamed to. Structured rather than spelled out in `reason` because
     * the consumer that performs the rename reads this listing as JSON. */
    pendingRename?: string;
    /** Something true about an entry that is going through fine - shown in the
     * quiet tone under the entry's line, where `reason` would sit for one that
     * isn't. For consequences the user can't infer from the label alone, like
     * a retitle whose file rename lands on the next pull. */
    remark?: string;
}
export interface RenderPlanOptions {
    /** Dresses the listing as the status screen: a "Changes not yet pushed
     * to iCloud:" heading with next-step hints above the change list. Used
     * by the previews (`status` and `push --dry-run`); a real `push` skips
     * the heading - its own "Pushed N note(s) from ..." line sits above the
     * listing instead - but keeps the same indentation and surrounding blank
     * lines, so all the changelist screens share one shape. */
    preview?: boolean;
    /** How many tracked notes the plan left untouched (see
     * `countUnchangedNotes`) - enables the trailing "N other note(s) match
     * the last pull." remark, and its "Nothing to push" variant. */
    unchanged?: number;
}
/**
 * Renders a push plan `git status`-style: one line per non-noop entry with
 * a colored label column and plain filename, an indented reason line
 * immediately under anything refused (black-on-red - push will never sync
 * it as-is) or conflicting (magenta - resolvable, then retry), and a
 * trailing summary line. Shared by `push --dry-run`, real `push`, and
 * `status` so the three can never show different things for the same state
 * - see the "Push becomes the full reconciler" project notes.
 *
 * `formatPath` is the presentation hook for git-style cwd-relative output:
 * entries keep vault-root-relative paths internally, and the CLI passes a
 * formatter that re-expresses them relative to the user's current
 * directory. It's also applied to occurrences of the path *inside* reason
 * lines (restore-command hints and the like), so suggested commands stay
 * copy-pasteable from wherever the user is standing.
 */
export declare function renderPlan(entries: readonly PlanEntry[], formatPath?: (file: string) => string, options?: RenderPlanOptions): string[];
/**
 * How many tracked notes a plan left untouched - the "N other notes match
 * the last pull." figure. Every non-create entry (update/delete/move)
 * accounts for exactly one tracked note; creates are untracked files, and a
 * clean tracked note produces no entry at all. A "noop" update (a byte-level
 * difference that resolved to no server-side change) counts as unchanged,
 * matching how the listing hides it. So does a "rename": what's out of step
 * there is the file's *name*, not the note, and the same note can carry a
 * real change entry alongside it - counting both would make the tally
 * describe more notes than the vault has.
 */
export declare function countUnchangedNotes(entries: readonly Pick<PlanEntry, "kind" | "resolution">[], trackedNotes: number): number;
/** Strips a `"<file>: "` prefix a refusal/conflict message was built with, so
 * it can be shown as the reason line under a plan entry without repeating
 * the filename `renderPlan` already printed on the line above it. */
export declare function stripFilePrefix(message: string, file: string): string;
/** A `PlanEntry` projected to its plain-data fields - what `status` and
 * `push --dry-run` both hand to `--json` callers (dropping `push`'s
 * `execute` closure, which isn't serializable and isn't anyone's business
 * outside this process). */
export type SerializedPlanEntry = Pick<PlanEntry, "kind" | "file" | "resolution" | "reason" | "previousFile" | "pendingRename" | "folderTitle" | "remark">;
/** Projects any `PlanEntry` (including `push`'s `ExecutablePlanEntry`, which
 * extends it with `execute`) down to its serializable fields. */
export declare function serializePlanEntry(entry: PlanEntry): SerializedPlanEntry;
