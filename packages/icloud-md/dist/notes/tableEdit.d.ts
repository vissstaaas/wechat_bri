/**
 * The incremental table write engine: grid-level diffing and in-place
 * structural editing of a parsed `TableDocument` (`decodeTableRecord.ts`),
 * following the table CRDT rulebook derived from the 2026-07-16 scripted
 * evolution capture and cross-validated against every committed fixture
 * (dev log 2026-07-16T16:31; the fixtures are `realFixtures.ts`'s
 * `TABLE_EVOLUTION_REVISIONS`). This replaces both prior designs - the
 * first incremental patcher that forgot the FFFC ordering mirror, and the
 * from-scratch rebuild whose single-identity/no-redirect shape turned out
 * not to be what Apple's clients merge (both corrupted a live table during
 * their verification passes; see the dev log's table write engine
 * investigation, and git history for their code).
 *
 * What the rulebook requires of every edit, and this engine does:
 *
 *  - **Register ourselves as a real replica, in both clock systems.**
 *    `Document.version` element *i* belongs to replica *i* and `uuidItem[i]`
 *    is its UUID (replica segment first, then identity UUIDs), so joining
 *    means inserting our UUID at the end of the replica segment - which
 *    shifts every identity object's `UUIDIndex` up by one (the layout is
 *    positional; done once, then reused). On the topotext side, every
 *    mergeable string in the table draws `CharID` clocks from the shared
 *    `Document.ttTimestamp` table, and - per Apple's own web-client source
 *    (`TTVectorMultiTimestamp.savetoArchive`/`replicaUUIDByIndex`, recovered
 *    2026-07-16 after the Stage-1 live doubling incident) - that table is a
 *    **sorted set, not a registration log**: entries are serialized in
 *    NSUUID order and a 1-based `CharID.replicaID` is the replica's *rank*
 *    among the sorted UUIDs. Registering therefore inserts our `Clock` at
 *    its sorted position and, when that displaces existing entries, remaps
 *    every `CharID` (run coordinate and style anchor) in every mergeable
 *    string of the document. Getting this wrong is invisible to a fresh
 *    parse (attribution stays self-consistent) but makes Apple's
 *    *incremental* merge attribute every char to the wrong replica and
 *    union instead of unify - the doubled-cells incident.
 *  - **Identity pairs are structural, not residue**: every row/column is
 *    born as an *ordering* identity (listed in `attachments`, self-paired
 *    in `set`) plus a *content* identity (keys `cellColumns`/row-map
 *    entries), permanently joined by a redirect entry
 *    (`OrderedSet.array.dictionary`, ordering -> content).
 *  - **The FFFC mirror is maintained by topotext splice**: one U+FFFC per
 *    live entry, inserted at the entry's visual position under our own
 *    clocks; deletion tombstones the exact character, with the tombstone's
 *    anchor (the run's *style timestamp*) rewritten under our style clock
 *    (`ttTimestamp`'s second `ReplicaClock`, `TTMergeableStringTimestampTypeStyle`
 *    in Apple's source). Both that mirror splice and every *cell-text*
 *    deletion restamp their tombstones by Apple's one shared rule -
 *    `max(old style clock + 8, this save's style-clock floor)`, then the
 *    counter ends past it (`generateIdsForLocalChanges`; the same rule
 *    `noteDocument.ts` applies to note bodies, and both sides of the `max`
 *    are checked against Apple's own saves by `TABLE_RESTYLE_REVISIONS`).
 *    This is not cosmetic:
 *    `mergeWithString_mergeTimestamps` adopts a remote tombstone only when
 *    its style timestamp compares *strictly greater*, so a tombstone left
 *    at its original anchor is discarded by every other client (audit,
 *    2026-08-02).
 *  - **Deletes physically remove** dictionary elements and cell-text
 *    objects (pool compaction remaps every reference), while **retaining
 *    forever** the redirect entry, both identity objects, and the UUIDs.
 *  - **Clock discipline**: each save re-stamps the direction marker's
 *    `registerLatest` at our tick base+1 and stamps every newly created
 *    `Dictionary.Element` at base+2 (structural and deletion-bearing saves
 *    land on base+2, pure text saves on base+1 - matching Apple's odd/even
 *    pattern); our version element advances to the highest tick used.
 *    Element stamps mark creation only and are never rewritten.
 *  - **Never reuse or renumber** existing UUIDs, redirects, orphaned
 *    identities, or `typeItem` entries - all preserved verbatim. (Apple
 *    also mints ~3 unused bookkeeping replicas and ~150 `CRTable`/`ICTable`
 *    `typeItem` pairs per save; per the rulebook's conservative treatment,
 *    we generate neither - nothing in the merge model appears to require
 *    them from a foreign replica.)
 *
 * One deliberate layout deviation: Apple inserts a new pair's two UUIDs
 * into `uuidItem` adjacent to their axis's existing identity UUIDs
 * (rewriting every later identity's `UUIDIndex`); we append them at the
 * end of the table instead. The mapping is index-based either way - grouping
 * within the identity segment is cosmetic - and appending leaves every
 * existing `UUIDIndex` untouched.
 *
 * `diffTableGrid` is deliberately narrower than a full two-dimensional LCS:
 * it only recognizes cell edits with unchanged structure, or a single
 * contiguous run of inserted or deleted rows *or* columns (never both axes
 * in the same edit) with every surviving row/column matching exactly - the
 * same single-splice model `noteDocument.ts`'s `computeSplice` uses for
 * plain text, generalized to row/column granularity. Anything messier is
 * classified `unsupported` and refused rather than guessed at; per the
 * project's binding scope decisions, reorders may be modeled as
 * delete+insert by the *user* (split into two pushes), and concurrent-edit
 * merging is a non-goal - our edits win, the bar is that Apple's own
 * clients render and merge what we write.
 */
import { type TableDocument } from "./decodeTableRecord.js";
export interface CellEdit {
    row: number;
    column: number;
    text: string;
}
export type TableEditPlan = {
    kind: "noop";
} | {
    kind: "cellEdits";
    edits: CellEdit[];
} | {
    kind: "insertRows";
    position: number;
    rows: string[][];
} | {
    kind: "deleteRows";
    position: number;
    count: number;
}
/** Each entry is one new column's cell text, top-to-bottom over the
 * table's (unchanged) row order. */
 | {
    kind: "insertColumns";
    position: number;
    columns: string[][];
} | {
    kind: "deleteColumns";
    position: number;
    count: number;
} | {
    kind: "unsupported";
    reason: string;
};
export declare function diffTableGrid(current: readonly string[][], desired: readonly string[][]): TableEditPlan;
/**
 * Diffs the document's current grid against `desiredGrid` and applies the
 * resulting plan in place under `replicaUuid` (the same per-clone replica
 * identity note-body edits use). Returns false when the grids already
 * match; throws (leaving `doc` possibly half-mutated - callers re-parse
 * from the original bytes on failure) when the edit is unsupported or any
 * invariant check fails.
 */
export declare function applyTableEdit(doc: TableDocument, desiredGrid: readonly string[][], replicaUuid: Uint8Array): boolean;
/**
 * Physically removes `removedRefs` from the pool and remaps every remaining
 * `ObjectID.objectIndex` reference in the document (including the three
 * refs cached on `doc` itself) to account for the shift - the mechanical
 * consequence of a flat, gapless `repeated` protobuf field: removing pool
 * entries shifts every reference past them down by however many were
 * removed. Deliberately generic over "what got removed" - `deleteRowAt`/
 * `deleteColumnAt` decide that; this only knows how to erase pool slots and
 * fix up every reference to what's left.
 */
export declare function compactPool(doc: TableDocument, removedRefs: readonly number[]): void;
/**
 * The machine-checkable slice of the table CRDT rulebook, verified against
 * every committed fixture (all 14 evolution revisions, all 10 write-path
 * revisions, both long-lived snapshots) before this engine was written -
 * run before and after every edit. The OrderedSet checks are the direct
 * regression test for both live corruption incidents: the first forgot the
 * mirror, the second broke the redirect/identity-pair join.
 */
export declare function validateTableDocumentInvariants(doc: TableDocument): void;
