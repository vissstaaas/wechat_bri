import { type CloudKitRecord } from "../cloudkit/databaseClient.js";
import { type CloneState } from "../notes/cloneState.js";
import { NoteDeleteRejectedError } from "../errors.js";
/**
 * The `object` command family: record-level plumbing for inspecting and
 * deleting raw CloudKit objects by ID, deliberately separate from the
 * file-path porcelain (`delete <file>`, `push`). Exists first and foremost
 * as the repair kit for broken note objects this tool may create - ones
 * that can break the Apple Notes UI itself - so nothing here ever requires
 * a record's content to parse. See the project notes (2026-07-16T11:10).
 */
export interface ObjectCommandOptions {
    onLoginStatus?: (message: string) => void;
}
export type ObjectLifecycleState = "live" | "trashed" | "purged" | "tombstone";
/** Everything `object list` derives per record - pure data, so the
 * derivation is testable without a network and `--json` is just
 * serialization. */
export interface ObjectInfo {
    recordName: string;
    recordType: string;
    state: ObjectLifecycleState;
    /** CloudKit record metadata (ms epoch) - who-wrote-when bookkeeping,
     * distinct from the Notes-level CreationDate/ModificationDate fields. */
    createdAt?: number | undefined;
    modifiedAt?: number | undefined;
    /** Decoded TitleEncrypted, when present and decodable. */
    title?: string | undefined;
    /** Outgoing references: recordNames this record points at (its folder,
     * its owning note, ...), from a generic scan of reference-shaped fields. */
    references: string[];
    /** How many other records in the zone point at this one - the count that
     * decides whether a `forceDelete` would be rejected. */
    referencedBy: number;
    /** The vault file this record corresponds to per state.json (a tracked
     * note's file, or a downloaded attachment's), if any. */
    trackedFile?: string | undefined;
    /** Note records only: whether this tool can actually make sense of the
     * record - the discovery signal for `--broken`. */
    health?: string | undefined;
}
export interface ObjectListFilters {
    type?: string | undefined;
    broken?: boolean;
    orphaned?: boolean;
    trashed?: boolean;
    untracked?: boolean;
}
export declare function runObjectList(targetDir: string, filters?: ObjectListFilters, options?: ObjectCommandOptions): Promise<ObjectInfo[]>;
/** One incoming reference as `object show` reports it: enough to identify
 * the referrer and judge whether it matters (a live Attachment blocks a
 * forceDelete; a tombstone doesn't). */
export interface IncomingReference {
    recordName: string;
    recordType: string;
    title?: string | undefined;
    state: ObjectLifecycleState;
}
export interface ObjectShowResult extends ObjectInfo {
    record: CloudKitRecord;
    incomingReferences: IncomingReference[];
}
export declare function runObjectShow(targetDir: string, recordName: string, options?: ObjectCommandOptions): Promise<ObjectShowResult>;
/** Every record in `index` holding a reference to `recordName` - the
 * by-name answer behind `object list`'s bare `<- N ref(s)` count. Exported
 * for tests; shared by `object show` and the `--force` cascade. */
export declare function findIncomingReferences(index: ObjectInfo[], recordName: string): IncomingReference[];
export interface ObjectDeleteOptions extends ObjectCommandOptions {
    /** Required for structural record types (Folders), where a typo'd ID has
     * a blast radius beyond the record itself. */
    yes?: boolean;
    /**
     * True immediate removal via `forceDelete`, cascading over leaf-type
     * referrers - the "this record is poison, get it out of the sync stream
     * NOW" escape hatch. Unlike the default two-stage purge (which only marks
     * the record and leaves its fields in `changes/zone` until server GC), a
     * forceDelete tombstones the record immediately - the only state
     * guaranteed safe when the record's content itself crashes Notes clients.
     */
    force?: boolean;
}
/**
 * Record types the `--force` cascade may delete on its own to unblock the
 * target: per-note leaves whose whole existence hangs off the record being
 * deleted. A Folder or another Note showing up as a blocker is collateral,
 * not cleanup - the cascade refuses and reports instead.
 */
export declare function isCascadableType(recordType: string): boolean;
export type ObjectDeleteOutcome = "already-deleted" | "purged" | "force-deleted";
export interface ObjectDeleteResult {
    recordName: string;
    recordType: string;
    title?: string | undefined;
    outcome: ObjectDeleteOutcome;
    /** `outcome: "force-deleted"` only: referrer records the `--force` cascade
     * had to delete first to unblock the target. */
    cascaded?: Array<{
        recordName: string;
        recordType: string;
        title?: string | undefined;
    }>;
}
export declare function runObjectDelete(targetDir: string, recordName: string, options?: ObjectDeleteOptions): Promise<ObjectDeleteResult>;
/** Turns an `ObjectDeleteResult` back into the message(s) this command used
 * to print directly - the CLI's human renderer. */
export declare function renderObjectDeleteResult(result: ObjectDeleteResult): string[];
/**
 * A `VALIDATING_REFERENCE_ERROR` reason names the blocking record's
 * recordID (observed live 2026-07-16: "recordID=<uuid> ... Record delete
 * would violate validating reference") - so even a failed delete can tell
 * the user exactly what stands in the way and what to run next. Exported
 * for tests.
 */
export declare function rejectionWithBlockerHint(recordName: string, serverErrorCode: string, reason: string | undefined): NoteDeleteRejectedError;
/** Pure derivation of everything `object list` shows - exported for tests. */
export declare function buildObjectIndex(records: CloudKitRecord[], state: CloneState): ObjectInfo[];
export declare function applyObjectFilters(index: ObjectInfo[], filters: ObjectListFilters): ObjectInfo[];
export declare function renderObjectList(index: ObjectInfo[]): string[];
