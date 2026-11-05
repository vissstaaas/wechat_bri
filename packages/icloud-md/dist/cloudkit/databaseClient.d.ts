import type { IcloudSession } from "../session.js";
export interface CloudKitFieldValue {
    value: unknown;
    type: string;
}
/** CloudKit's record-level bookkeeping for who wrote a record and when -
 * distinct from the Notes-app-level CreationDate/ModificationDate fields. */
export interface CloudKitRecordStamp {
    /** ms epoch. */
    timestamp: number;
    deviceID?: string | undefined;
}
/** One participant of a `cloudkit.share` record, flattened from CloudKit's
 * nested userIdentity shape to just what this tool uses: identifying the
 * sharer (`type === "OWNER"`) by a human-readable name. */
export interface ShareParticipant {
    type?: string | undefined;
    userRecordName?: string | undefined;
    givenName?: string | undefined;
    familyName?: string | undefined;
    emailAddress?: string | undefined;
    phoneNumber?: string | undefined;
}
export interface CloudKitRecord {
    recordName: string;
    recordType: string;
    fields: Record<string, CloudKitFieldValue>;
    recordChangeTag?: string | undefined;
    deleted?: boolean | undefined;
    /** The record's parent reference (for notes: the containing folder).
     * Echoed back on updates the way the web client does. */
    parentRecordName?: string | undefined;
    created?: CloudKitRecordStamp | undefined;
    modified?: CloudKitRecordStamp | undefined;
    /** `cloudkit.share` records only: who shares this zone's content. */
    participants?: ShareParticipant[] | undefined;
    /** The `cloudkit.share` record this record is the root of, when shared -
     * a shared Folder record carries this, linking it to the share whose
     * `currentUserPermission` gates our writes into it. */
    shareRecordName?: string | undefined;
    /** `cloudkit.share` records only: this account's own permission on the
     * share ("READ_WRITE" / "READ_ONLY"), straight from the response's
     * `currentUserParticipant` - no participant matching needed. */
    currentUserPermission?: string | undefined;
}
export interface ZoneChangesResult {
    records: CloudKitRecord[];
    syncToken: string | undefined;
    /** True when the caller's sync token was rejected by the server and the
     * zone was refetched from scratch instead. `records` is then a *complete
     * listing* of the zone, not an incremental delta - deletions carry no
     * tombstones, so a tracked record absent from it no longer exists remotely
     * and the caller must reconcile that itself. */
    resyncedFromScratch: boolean;
}
/** Which of the container's databases to talk to. Notes shared *with* this
 * account live in zones of the `shared` database, owned by other users. */
export type CloudKitDatabase = "private" | "shared";
export interface CloudKitZoneID {
    zoneName: string;
    ownerRecordName?: string | undefined;
}
/** The database + zoneID a note's reads and writes go to. */
export interface NoteZone {
    database: CloudKitDatabase;
    zoneID: CloudKitZoneID;
}
/** Own notes live in the private Notes zone; a shared note lives in its
 * sharer's zone of the shared database (same zoneName, owner-qualified).
 * `sharedZoneOwner` is the tracked note's state field of the same name. */
export declare function noteZone(sharedZoneOwner: string | undefined): NoteZone;
/** One shared zone's worth of note records, tagged with its owner so state
 * tracking can tell which sharer's zone each note came from. */
export interface SharedZoneChanges {
    zoneID: CloudKitZoneID;
    records: CloudKitRecord[];
    syncToken: string | undefined;
    /** See `ZoneChangesResult.resyncedFromScratch` - same semantics, per zone. */
    resyncedFromScratch: boolean;
}
/**
 * Fetches records in one Notes zone by paging through `changes/zone` until
 * `moreComing` is false, following the same `syncToken`-based
 * incremental-sync model the web client uses. Pass `sinceSyncToken` (from a
 * prior call's result) to fetch only what changed since then; omit it for a
 * full initial fetch. Returns the new syncToken so a future call can resume
 * from here.
 *
 * A `sinceSyncToken` the server no longer accepts doesn't abort the fetch:
 * the zone is refetched from scratch instead, reported via
 * `resyncedFromScratch` (see `ZoneChangesResult`). Live probing (2026-07-31)
 * established how an unusable token actually surfaces: a zone-level
 * BAD_REQUEST inside an HTTP 200 ("Unknown sync continuation type" for a
 * malformed token, "Invalid continuation format" for a corrupted one), while
 * a merely *old* token - 15 days, in the probe - still syncs incrementally.
 * A genuinely expired token can't be forced on demand, so BAD_REQUEST is the
 * one observed failure shape and the only code that triggers the fallback;
 * the web client offers no more guidance, since it holds tokens only in page
 * memory and can never see one expire. If BAD_REQUEST was actually caused by
 * something else in the request, the token-free retry hits it identically
 * and that error propagates - the fallback only "sticks" when dropping the
 * token was the fix.
 */
export declare function fetchZoneNoteRecords(session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, sinceSyncToken?: string, onPage?: (pageRecordCount: number) => void): Promise<ZoneChangesResult>;
/**
 * Fetches *every* record in the private Notes zone, of every type and with
 * every field - unlike `fetchZoneNoteRecords`, no `desiredRecordTypes` or
 * `desiredKeys` filter is sent (the sync path's filter notably excludes
 * `Attachment` and `Media` records, exactly what record-level inspection
 * most needs to see). Always a full walk from scratch; diagnostics want the
 * complete current picture, not an incremental delta. Read-only.
 */
export declare function fetchAllZoneRecords(session: IcloudSession, ckDatabaseHost: string, dsid: string, onPage?: (pageRecordCount: number) => void): Promise<CloudKitRecord[]>;
/** Fetches records in the account's own (private-database) Notes zone. */
export declare function fetchAllNoteRecords(session: IcloudSession, ckDatabaseHost: string, dsid: string, sinceSyncToken?: string, onPage?: (pageRecordCount: number) => void): Promise<ZoneChangesResult>;
/**
 * Lists the zones of the shared database - one per user who has shared
 * note(s) with this account (`zoneName` is "Notes", `ownerRecordName`
 * identifies the sharer). Mirrors the web client's `shared/changes/database`
 * call, which it issues with an empty body on every load rather than a
 * stored database-level syncToken (zone-level tokens carry the actual
 * incremental state), then pages with the response's top-level `syncToken`
 * until `moreComing` is false. A truncated listing would be silently
 * destructive: any zone past page one looks vanished, and pull untracks
 * every note from that sharer as "no longer shared with you".
 */
export declare function fetchSharedZoneIds(session: IcloudSession, ckDatabaseHost: string, dsid: string): Promise<CloudKitZoneID[]>;
/** One page of a shared `changes/database` listing; `moreComing`/`syncToken`
 * drive the pagination loop in `fetchSharedZoneIds`. */
export interface SharedZoneListPage {
    zoneIds: CloudKitZoneID[];
    moreComing: boolean;
    syncToken: string | undefined;
}
export declare function parseSharedZoneList(body: unknown): SharedZoneListPage;
export declare function lookupRecords(session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, recordNames: string[]): Promise<CloudKitRecord[]>;
/** A shared zone whose fetch didn't complete this run, skipped rather than
 * fatal; see `fetchSharedNoteRecords`. Two distinct shapes:
 *
 * - `"zone-not-found"`: `changes/zone` answered ZONE_NOT_FOUND for a zone the
 *   `changes/database` listing advertised - a share revoked or deleted out
 *   from under the listing.
 * - `"missing-note-bodies"`: the zone listed fine, but one or more live Note
 *   records still had no `TextDataEncrypted` after the `records/lookup`
 *   backfill (a throttled/failed per-record lookup, or a record deleted
 *   between listing and lookup). Processing the zone anyway would classify
 *   those notes unsyncable and permanently untrack them over what is usually
 *   a transient failure - so the whole zone waits for a later pull, and its
 *   syncToken must not advance. */
export type SkippedSharedZone = {
    zoneID: CloudKitZoneID;
    reason: "zone-not-found";
    serverErrorCode: string;
} | {
    zoneID: CloudKitZoneID;
    reason: "missing-note-bodies";
    missingRecordNames: string[];
};
export interface SharedNoteRecordsResult {
    zones: SharedZoneChanges[];
    skippedZones: SkippedSharedZone[];
}
/**
 * Fetches every shared zone's note records, filling in note bodies (via
 * `records/lookup`) for live Note records the zone listing returned without
 * `TextDataEncrypted`. `sinceSyncTokens` is keyed by the zone owner's
 * recordName; zones without an entry are fetched from scratch.
 *
 * A zone that answers ZONE_NOT_FOUND (a share revoked/deleted but still
 * enumerated by `changes/database`) is reported in `skippedZones` instead of
 * aborting the run - one unfetchable share shouldn't discard every other
 * zone's successful results. So is a zone with note bodies still missing
 * after the lookup backfill (see `SkippedSharedZone`): its results are
 * incomplete, and acting on them would untrack notes over a transient
 * failure. Any other zone-level error stays fatal: that's a broken fetch,
 * not a missing zone, and swallowing it would make it look like a clean
 * sync.
 */
export declare function fetchSharedNoteRecords(session: IcloudSession, ckDatabaseHost: string, dsid: string, sinceSyncTokens?: Record<string, string>, onPage?: (pageRecordCount: number) => void): Promise<SharedNoteRecordsResult>;
/** Replaces zone-listing records in place with their full looked-up versions. */
export declare function mergeLookedUpRecords(records: CloudKitRecord[], lookedUp: CloudKitRecord[]): void;
/**
 * Downloads an attachment's raw bytes from its signed `cvws.icloud-content.com`
 * URL (the `downloadURL` on a Media record's `Asset` field). These URLs are
 * plain, unauthenticated GETs - no cookie or session header, just the
 * signature baked into the query string - confirmed against real captures of
 * both an audio and an image attachment (dev notes, 2026-07-13/14). They do
 * carry an expiry (`e=` query param), so a stored URL can go stale; re-`lookup`
 * the owning record to get a fresh one rather than retrying the same URL.
 */
export declare function fetchAssetBytes(downloadURL: string): Promise<Buffer>;
export interface NoteUpdate {
    recordName: string;
    /** Optimistic-concurrency token: the server rejects the update if the
     * record has moved past this tag - exactly the "don't clobber a change
     * you haven't seen" primitive push is built on. */
    recordChangeTag: string;
    fields: Record<string, {
        value: unknown;
    }>;
    parentRecordName?: string | undefined;
}
export type NoteUpdateResult = {
    ok: true;
    record: CloudKitRecord;
} | {
    ok: false;
    serverErrorCode: string;
    reason: string | undefined;
};
/**
 * Updates one note via `records/modify`, using the same single-operation
 * `update` shape the web client sends. Per-record failures (notably a
 * changeTag conflict) come back inside an HTTP 200 as `serverErrorCode` on
 * the record entry; those are returned as a typed refusal rather than
 * thrown, since "someone else edited this note" is an expected outcome the
 * caller wants to report per-note.
 */
export declare function updateNoteRecord(session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, update: NoteUpdate): Promise<NoteUpdateResult>;
export declare function parseNoteUpdateResponse(body: unknown): NoteUpdateResult;
/** Extras a shared-database create needs beyond the private-proven shape:
 * CloudKit record hierarchy (`parent` at the containing Folder record) is
 * what makes the new note a member of the folder's share, and the captured
 * shared create also asks for a short GUID. The private-db capture sent
 * both too, but our private path omits them and is live-verified - they're
 * optional there, so the private shape stays untouched. */
export interface CreateNoteExtras {
    parentRecordName?: string | undefined;
    createShortGUID?: boolean | undefined;
}
/**
 * Creates one brand-new Note record via `records/modify`, mirroring the
 * captured first-ever save of a fresh note (operationType "create", a
 * client-generated recordName, no recordChangeTag - see the 2026-07-16
 * lifecycle HAR analysis; the shared-database variant is the 2026-07-17
 * shared-note-modifications capture). The response is a full record
 * carrying the note's first recordChangeTag, same shape as an update's.
 */
export declare function createNoteRecord(session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, recordName: string, fields: Record<string, {
    value: unknown;
}>, extras?: CreateNoteExtras): Promise<NoteUpdateResult>;
/**
 * Creates one brand-new Folder record. A folder is a far smaller thing than
 * a note on the wire: a top-level one carries a single `TitleEncrypted`
 * field and nothing else (confirmed against a folder created by the web
 * client, 2026-07-30), and a nested one adds a `ParentFolder` reference plus
 * the matching CloudKit record-level parent - see `encodeFolderRecord.ts`
 * for the field construction.
 */
export declare function createFolderRecord(session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, recordName: string, fields: Record<string, {
    value: unknown;
}>, extras?: CreateNoteExtras): Promise<NoteUpdateResult>;
/**
 * The `records/modify` create the two wrappers above submit, by record type.
 *
 * Exported because record types beyond Note and Folder do get created against
 * a real zone - `Attachment`, for the live suite's planted table fixture
 * (`integration/plantTable.ts`). Keeping that on this one code path is the
 * point: the harness writes through the same request builder, logging and
 * response parsing as production rather than a second, unproven copy of them.
 */
export declare function createZoneRecord(recordType: string, session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, recordName: string, fields: Record<string, {
    value: unknown;
}>, extras?: CreateNoteExtras): Promise<NoteUpdateResult>;
export type NoteDeleteResult = {
    ok: true;
} | {
    ok: false;
    serverErrorCode: string;
    reason: string | undefined;
};
/**
 * Deletes one record via CloudKit's `forceDelete` operation. NOT what
 * Apple's own clients do for user-facing note deletion - both stages of
 * that flow are ordinary updates (trash-move, then `Deleted: 1`; see the
 * 2026-07-16 lifecycle/purge HAR analyses), and `forceDelete` on a Note is
 * rejected with `VALIDATING_REFERENCE_ERROR` whenever an Attachment record
 * still references it (confirmed live). Kept for record-level plumbing (the
 * `object` command family): it's the only way to delete a *non-Note* record
 * such as an orphaned Attachment, live-verified to work when nothing
 * references the target.
 */
export declare function forceDeleteRecord(session: IcloudSession, ckDatabaseHost: string, dsid: string, zoneID: CloudKitZoneID, recordName: string, recordType: string, recordChangeTag: string): Promise<NoteDeleteResult>;
/**
 * A successful `forceDelete` response record entry looks nothing like an
 * `update` one - confirmed live 2026-07-16: `{"recordName": "...",
 * "deleted": true}`, with no `recordType`/`fields`/`recordChangeTag` at
 * all. `parseNoteUpdateResponse`'s `parseRecord` call requires those, so it
 * throws on a genuinely successful delete - this is a dedicated parser
 * instead of a shared one, since there's no full record to hand back to a
 * delete caller anyway (there's nothing left to describe).
 */
export declare function parseNoteDeleteResponse(body: unknown): NoteDeleteResult;
export interface RecordUpdate {
    recordName: string;
    /** Unlike the single-record `updateNoteRecord`, not hardcoded to "Note" -
     * a table write needs to update a Note record and an Attachment record
     * (the table's own `MergeableDataEncrypted`) atomically in one call. */
    recordType: string;
    /** Optimistic-concurrency token; see `NoteUpdate`. */
    recordChangeTag: string;
    fields: Record<string, {
        value: unknown;
    }>;
    parentRecordName?: string | undefined;
}
export type RecordUpdateResult = NoteUpdateResult;
/**
 * Updates any number of records in one zone via a single `records/modify`
 * call with one `update` operation per record - the real CloudKit endpoint
 * already accepts multiple operations atomically per zone; `updateNoteRecord`
 * used to hardcode a single-element operations array as a self-imposed
 * limitation, not a server one. Results come back in the same order as
 * `updates`, each independently `ok`/refused (a changeTag conflict on one
 * record doesn't fail the others) - though a caller relying on the *write*
 * being atomic (e.g. a note's text and its table changing together) should
 * still treat any non-`ok` result as "nothing in this batch should be
 * trusted as applied", since CloudKit only guarantees atomicity of the
 * write itself, not of how per-record failures are reported back.
 */
export declare function updateRecords(session: IcloudSession, ckDatabaseHost: string, dsid: string, database: CloudKitDatabase, zoneID: CloudKitZoneID, updates: RecordUpdate[]): Promise<RecordUpdateResult[]>;
export declare function parseRecordUpdateResponse(body: unknown): RecordUpdateResult[];
interface ParsedZone {
    moreComing?: boolean | undefined;
    syncToken?: string | undefined;
    records?: CloudKitRecord[] | undefined;
}
export declare function firstZone(body: unknown): ParsedZone;
export {};
