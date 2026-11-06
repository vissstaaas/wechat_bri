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
import { randomBytes } from "node:crypto";
import { create, isFieldSet } from "@bufbuild/protobuf";
import { computePositions, parseOrderedSet, parseRefPairList, resolveRef, resolveTable, uuidIndexOfRef, gridFromTableDocument, cellKey, bytesEqual, OBJECT_INDEX_FIELD, UNSIGNED_INTEGER_VALUE_FIELD, } from "./decodeTableRecord.js";
import { applyCellTextEdit, encodeCellDocument, insertVisibleText, newCellDocument, parseCellDocument, tombstoneVisibleRange, validateCellInvariants, } from "./tableCellEdit.js";
import { pushObject, pushUuid, requireKeyIndex, stampedDictionaryElement } from "./mergeableDataPool.js";
import { OBJECT_REPLACEMENT_CHARACTER } from "./noteAttachments.js";
import { DictionarySchema, Document_CustomObjectSchema, Document_CustomObject_MapEntrySchema, Document_DocObjectSchema, ObjectIDSchema, StringArray_ArrayAttachmentSchema, VectorTimestamp_ElementSchema, } from "./gen/crdt_pb.js";
import { AttributeRunSchema, VectorTimestamp_ClockSchema as TtClockSchema, VectorTimestamp_Clock_ReplicaClockSchema as TtReplicaClockSchema, } from "./gen/topotext_pb.js";
/** The identity objects' `typeItem` entry; index 2 in every capture, but
 * looked up by name rather than assumed. */
const IDENTITY_TYPE_NAME = "com.apple.CRDT.NSUUID";
/** Apple's deletion bias when restamping a tombstoned run's style timestamp
 * (`generateIdsForLocalChanges`: `timestamp.clock + (isTombstone ? 8 : 1)`),
 * the same constant `noteDocument.ts` uses for note bodies. */
const TOMBSTONE_STYLE_CLOCK_BIAS = 8;
export function diffTableGrid(current, desired) {
    if (gridsEqual(current, desired)) {
        return { kind: "noop" };
    }
    const currentCols = current[0]?.length ?? 0;
    const desiredCols = desired[0]?.length ?? 0;
    const rowCountChanged = current.length !== desired.length;
    const colCountChanged = currentCols !== desiredCols;
    if (rowCountChanged && colCountChanged) {
        return {
            kind: "unsupported",
            reason: "both row and column counts changed in the same edit - can't safely resolve this as one structural operation",
        };
    }
    if (!rowCountChanged && !colCountChanged) {
        if (isPureReorder(current, desired)) {
            return {
                kind: "unsupported",
                reason: "rows or columns were reordered without anything added or removed - not supported in one edit (split it into a delete push and an insert push)",
            };
        }
        const edits = [];
        current.forEach((row, r) => {
            row.forEach((cell, c) => {
                const desiredCell = desired[r]?.[c];
                if (desiredCell !== undefined && desiredCell !== cell) {
                    edits.push({ row: r, column: c, text: desiredCell });
                }
            });
        });
        return edits.length === 0 ? { kind: "noop" } : { kind: "cellEdits", edits };
    }
    if (rowCountChanged) {
        const splice = computeAxisSplice(current, desired);
        if (!splice) {
            return { kind: "unsupported", reason: "row insertion/deletion couldn't be resolved to a single contiguous change" };
        }
        return splice.deleteCount > 0
            ? { kind: "deleteRows", position: splice.start, count: splice.deleteCount }
            : { kind: "insertRows", position: splice.start, rows: splice.inserted };
    }
    const splice = computeAxisSplice(transpose(current), transpose(desired));
    if (!splice) {
        return { kind: "unsupported", reason: "column insertion/deletion couldn't be resolved to a single contiguous change" };
    }
    return splice.deleteCount > 0
        ? { kind: "deleteColumns", position: splice.start, count: splice.deleteCount }
        : { kind: "insertColumns", position: splice.start, columns: splice.inserted };
}
/** `computeSplice` (`noteDocument.ts`), generalized from characters to
 * whole rows: the longest matching prefix + longest matching suffix, with
 * everything in between treated as one contiguous insert or delete. Returns
 * undefined if the prefix/suffix trim doesn't account for every row outside
 * the changed region - i.e. something beyond a single clean insert/delete
 * is going on, which `diffTableGrid` reports as `unsupported`. */
function computeAxisSplice(current, desired) {
    const minLen = Math.min(current.length, desired.length);
    let prefix = 0;
    while (prefix < minLen && rowsEqual(current[prefix], desired[prefix])) {
        prefix += 1;
    }
    let suffix = 0;
    const maxSuffix = minLen - prefix;
    while (suffix < maxSuffix && rowsEqual(current[current.length - 1 - suffix], desired[desired.length - 1 - suffix])) {
        suffix += 1;
    }
    if (prefix + suffix !== minLen) {
        return undefined;
    }
    const deleteCount = current.length - prefix - suffix;
    const insertCount = desired.length - prefix - suffix;
    const inserted = desired.slice(prefix, prefix + insertCount).map((row) => [...row]);
    return { start: prefix, deleteCount, inserted };
}
function rowsEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}
function gridsEqual(a, b) {
    return a.length === b.length && a.every((row, i) => rowsEqual(row, b[i] ?? []));
}
function transpose(grid) {
    const cols = grid[0]?.length ?? 0;
    return Array.from({ length: cols }, (_, c) => grid.map((row) => row[c] ?? ""));
}
/** A pure reorder: the same multiset of rows (or, transposed, columns), in
 * a different order, with nothing added or removed. Deliberately refused -
 * see file header. */
function isPureReorder(current, desired) {
    if (rowsMultisetEqual(current, desired)) {
        return true;
    }
    return rowsMultisetEqual(transpose(current), transpose(desired));
}
function rowsMultisetEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    const counts = new Map();
    for (const row of b) {
        const key = JSON.stringify(row);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of a) {
        const key = JSON.stringify(row);
        const count = counts.get(key) ?? 0;
        if (count === 0) {
            return false;
        }
        counts.set(key, count - 1);
    }
    return true;
}
/** The stamp for `Dictionary.Element`s created in this save (base+2, shared
 * by everything created in one save), also marking the save structural. */
function elementStamp(session) {
    session.highestTick = Math.max(session.highestTick, session.baseClock + 2);
    return { replicaIndex: session.replicaIndex, clock: session.baseClock + 2 };
}
/** Marks this save as a structural one (base+2), the tick a deletion-bearing
 * save lands on in every capture. The tombstone stamping itself lives in the
 * session's `TopotextClockSource` (`takeTombstoneAnchor`), shared with cell
 * text - as it is in Apple's client. */
function markStructuralSave(session) {
    session.highestTick = Math.max(session.highestTick, session.baseClock + 2);
}
function compareUuidBytes(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return a.length - b.length;
}
/** Rewrites every non-origin `CharID` (run coordinate and style anchor) in
 * every mergeable string of the document - cells and both ordering mirrors
 * are the same `topotext.String` shape. Replica 0 (the origin/sentinel
 * pseudo-replica) is never remapped. */
function remapCharIds(doc, map) {
    for (const entry of doc.objects) {
        for (const str of [entry.string, entry.tsOrderedSet?.array?.array?.contents]) {
            if (!str) {
                continue;
            }
            for (const run of str.substring) {
                for (const id of [run.charID, run.timestamp]) {
                    if (id && id.replicaID !== 0) {
                        id.replicaID = map(id.replicaID);
                    }
                }
            }
        }
    }
}
/**
 * Heals a document whose `ttTimestamp` entries aren't in sorted UUID order -
 * the residue of this engine's own first live push, which *appended* its
 * `Clock` entry (the Stage-1 doubled-cells incident, dev log 2026-07-16).
 * Apple's encoder provably always emits the table sorted
 * (`TTVectorMultiTimestamp.savetoArchive` iterates `sortedUUIDs()`), so an
 * unsorted table can only be our own residue; restoring the writing
 * engine's intent - wire index -> sorted rank - reproduces exactly what the
 * fixed engine would have written. Refuses (rather than reinterprets) an
 * unsorted document that doesn't carry `replicaUuid`, since "our residue"
 * is the only unsorted shape whose intent we can know.
 */
function normalizeTopotextOrder(doc, replicaUuid) {
    const tt = doc.document.ttTimestamp;
    if (!tt || tt.clock.length < 2) {
        return;
    }
    const order = tt.clock.map((_clock, index) => index);
    order.sort((a, b) => compareUuidBytes(tt.clock[a].replicaUUID, tt.clock[b].replicaUUID));
    if (order.every((oldIndex, newIndex) => oldIndex === newIndex)) {
        return;
    }
    if (!tt.clock.some((clock) => bytesEqual(clock.replicaUUID, replicaUuid))) {
        throw new Error("Table's topotext clock table isn't in sorted UUID order and isn't this tool's own residue - refusing to edit");
    }
    const oldToNew = new Map();
    order.forEach((oldIndex, newIndex) => oldToNew.set(oldIndex + 1, newIndex + 1));
    tt.clock = order.map((oldIndex) => tt.clock[oldIndex]);
    remapCharIds(doc, (oldReplicaId) => {
        const next = oldToNew.get(oldReplicaId);
        if (next === undefined) {
            throw new Error(`Table run references topotext replica ${oldReplicaId}, outside the clock table - refusing to edit`);
        }
        return next;
    });
}
function beginWriteSession(doc, replicaUuid) {
    if (replicaUuid.length !== 16) {
        throw new Error("Table write replica UUID must be 16 bytes");
    }
    // --- CRDT side: Document.version + the uuidItem replica segment ---
    const replicaCount = doc.version.element.length;
    if (replicaCount === 0) {
        throw new Error("Table document has an empty version vector - refusing to edit a document shaped like nothing ever captured");
    }
    doc.version.element.forEach((element, i) => {
        if (Number(element.replicaIndex) !== i) {
            throw new Error(`Table version vector element ${i} claims replica ${element.replicaIndex} - refusing to edit`);
        }
    });
    if (doc.uuidTable.length < replicaCount) {
        throw new Error("Table UUID table is shorter than its version vector - refusing to edit");
    }
    let replicaIndex = -1;
    for (let i = 0; i < replicaCount; i += 1) {
        if (bytesEqual(doc.uuidTable[i], replicaUuid)) {
            replicaIndex = i;
            break;
        }
    }
    let versionElement;
    if (replicaIndex === -1) {
        // First contact: insert our UUID at the end of the replica segment.
        // The identity segment starts right after it, so every identity
        // object's UUIDIndex shifts up by one - mandatory, the layout is
        // positional (dev log 2026-07-16T16:31).
        replicaIndex = replicaCount;
        doc.uuidTable.splice(replicaCount, 0, new Uint8Array(replicaUuid));
        shiftIdentityUuidIndexes(doc, replicaCount);
        versionElement = create(VectorTimestamp_ElementSchema, { replicaIndex: BigInt(replicaIndex), clock: 0n, subclock: 0n });
        doc.version.element.push(versionElement);
    }
    else {
        versionElement = doc.version.element[replicaIndex];
    }
    const baseClock = Number(versionElement.clock);
    // --- topotext side: the shared ttTimestamp clock table ---
    const tt = doc.document.ttTimestamp;
    if (!tt) {
        // Every fixture and capture carries one; a table without it is a shape
        // we've never seen, and inventing the whole table risks aliasing
        // whatever implicit clock space its existing runs use.
        throw new Error("Table document has no topotext clock table (ttTimestamp) - refusing to edit");
    }
    let ttIndex = tt.clock.findIndex((clock) => bytesEqual(clock.replicaUUID, replicaUuid));
    if (ttIndex === -1) {
        // The clock table is a *sorted set* (see the file header): insert our
        // entry at its NSUUID-sorted rank, and when that displaces existing
        // entries, shift every displaced rank's CharIDs up by one across the
        // whole document. The entry itself matches the observed two-counter
        // shape: text clock (total UTF-16 units inserted), then the style
        // clock, which starts at 1 on every fresh replica observed.
        const position = tt.clock.filter((clock) => compareUuidBytes(clock.replicaUUID, replicaUuid) < 0).length;
        if (position < tt.clock.length) {
            remapCharIds(doc, (oldReplicaId) => (oldReplicaId >= position + 1 ? oldReplicaId + 1 : oldReplicaId));
        }
        tt.clock.splice(position, 0, create(TtClockSchema, {
            replicaUUID: new Uint8Array(replicaUuid),
            replicaClock: [create(TtReplicaClockSchema, { clock: 0 }), create(TtReplicaClockSchema, { clock: 1 })],
        }));
        ttIndex = position;
    }
    const ttClock = tt.clock[ttIndex];
    const textCounter = ttClock.replicaClock[0];
    if (!textCounter) {
        throw new Error("Table's topotext clock entry has no text counter - refusing to guess");
    }
    // Apple's `generateIdsForLocalChanges` captures the replica's style clock
    // once per save (its local `r`) and uses that value as the floor for every
    // run it restamps in that pass, while the counter itself accumulates - so
    // two runs tombstoned in one save can share an anchor. Captured here for
    // the same reason.
    const styleCounter = ttClock.replicaClock[1];
    const styleFloor = styleCounter ? Number(styleCounter.clock) : 0;
    return {
        doc,
        replicaIndex,
        versionElement,
        baseClock,
        highestTick: 0,
        textClock: {
            // CharID.replicaID is a 1-based index into ttTimestamp.clock (0 is
            // the origin/sentinel pseudo-replica).
            replicaIndex: ttIndex + 1,
            take(units) {
                const value = Number(textCounter.clock);
                textCounter.clock = value + units;
                return value;
            },
            takeTombstoneAnchor(previousClock) {
                if (!styleCounter) {
                    throw new Error("Table's topotext clock entry is missing its style clock - refusing to guess");
                }
                const assigned = Math.max(previousClock + TOMBSTONE_STYLE_CLOCK_BIAS, styleFloor);
                styleCounter.clock = Math.max(Number(styleCounter.clock), assigned + 1);
                return assigned;
            },
        },
    };
}
function finalizeWriteSession(session) {
    // Our version element always advances so foreign vector comparisons see
    // this save (text-only saves land on base+1, structural on base+2). This
    // is what makes the save visible at all: Apple's
    // `mergeResultForMergingWithDocument` returns NoChange - discarding the
    // whole document - unless the incoming version vector is *ascending*
    // somewhere against the receiver's.
    //
    // The direction marker's registerLatest is deliberately NOT re-stamped:
    // the scripted capture's same-device saves always did, but the real
    // multi-device 2AV->2AX save shows a foreign device leaving it alone.
    // Leaving it alone is also the safe side of `CRRegisterLatest.mergeWith`,
    // which is last-writer-wins on `(counter, replicaUUID)`: not touching the
    // register means we never contend for a value we aren't changing. (Apple's
    // own restamp, in the `contents` setter, would take
    // `max(document clock, existing counter) + 1` and so would *win* - the
    // earlier reading of this comment, that a foreign restamp would compare
    // lower, was wrong; the decision stands on the observed foreign-device
    // behaviour.)
    session.versionElement.clock = BigInt(Math.max(session.highestTick, session.baseClock + 1));
}
/** Increments every identity object's UUIDIndex by one, for a UUID
 * inserted into `uuidItem` at `insertedAt` (the replica-segment end). By
 * the segmentation invariant every identity index is >= the replica count;
 * anything below is a document we don't understand. */
function shiftIdentityUuidIndexes(doc, insertedAt) {
    const uuidIndexKey = requireKeyIndex(doc, "UUIDIndex");
    for (const entry of doc.objects) {
        if (!entry.custom || entry.custom.mapEntry.length !== 1) {
            continue;
        }
        const [mapEntry] = entry.custom.mapEntry;
        if (!mapEntry || mapEntry.key !== uuidIndexKey || !mapEntry.value || !isFieldSet(mapEntry.value, UNSIGNED_INTEGER_VALUE_FIELD)) {
            continue;
        }
        const current = Number(mapEntry.value.unsignedIntegerValue);
        if (current < insertedAt) {
            throw new Error(`Table identity object references UUID-table index ${current}, inside the replica segment (${insertedAt}) - refusing to edit`);
        }
        mapEntry.value.unsignedIntegerValue = BigInt(current + 1);
    }
}
// --- applying a plan --------------------------------------------------
/**
 * Diffs the document's current grid against `desiredGrid` and applies the
 * resulting plan in place under `replicaUuid` (the same per-clone replica
 * identity note-body edits use). Returns false when the grids already
 * match; throws (leaving `doc` possibly half-mutated - callers re-parse
 * from the original bytes on failure) when the edit is unsupported or any
 * invariant check fails.
 */
export function applyTableEdit(doc, desiredGrid, replicaUuid) {
    const numColumns = desiredGrid[0]?.length ?? 0;
    if (desiredGrid.length === 0 || numColumns === 0) {
        throw new Error("Cannot edit a table down to no rows or no columns - delete the table from the note instead");
    }
    for (const row of desiredGrid) {
        if (row.length !== numColumns) {
            throw new Error("Every row of an edited table must have the same number of columns");
        }
    }
    normalizeTopotextOrder(doc, replicaUuid);
    validateTableDocumentInvariants(doc);
    const plan = diffTableGrid(gridFromTableDocument(doc), desiredGrid);
    if (plan.kind === "noop") {
        return false;
    }
    if (plan.kind === "unsupported") {
        throw new Error(plan.reason);
    }
    const session = beginWriteSession(doc, replicaUuid);
    switch (plan.kind) {
        case "cellEdits":
            applyCellEdits(session, plan.edits);
            break;
        case "insertRows":
            plan.rows.forEach((cellTexts, offset) => insertRowAt(session, plan.position + offset, cellTexts));
            break;
        case "deleteRows":
            for (let i = 0; i < plan.count; i += 1) {
                deleteRowAt(session, plan.position);
            }
            break;
        case "insertColumns":
            plan.columns.forEach((cellTexts, offset) => insertColumnAt(session, plan.position + offset, cellTexts));
            break;
        case "deleteColumns":
            for (let i = 0; i < plan.count; i += 1) {
                deleteColumnAt(session, plan.position);
            }
            break;
    }
    finalizeWriteSession(session);
    validateTableDocumentInvariants(doc);
    const resultGrid = gridFromTableDocument(doc);
    if (!gridsEqual(resultGrid, desiredGrid)) {
        throw new Error("Table edit did not produce the desired grid - refusing to write the result");
    }
    return true;
}
function applyCellEdits(session, edits) {
    const doc = session.doc;
    const resolved = resolveTable(doc);
    for (const edit of edits) {
        if (!resolved.rows[edit.row] || !resolved.columns[edit.column]) {
            throw new Error(`Cell edit references row ${edit.row}/column ${edit.column} outside the table`);
        }
        const cell = resolved.cells.get(cellKey(edit.row, edit.column));
        if (!cell) {
            throw new Error(`No cell found at row ${edit.row}, column ${edit.column}`);
        }
        const entry = doc.objects[cell.textRef];
        if (!entry?.string) {
            throw new Error(`Table pool[${cell.textRef}] is not a cell-text object`);
        }
        const cellDoc = parseCellDocument(entry.string);
        applyCellTextEdit(cellDoc, edit.text, session.textClock);
        entry.string = encodeCellDocument(cellDoc);
    }
}
function mintIdentityPair(doc) {
    const uuidIndexKey = requireKeyIndex(doc, "UUIDIndex");
    const identityType = doc.document.typeItem.indexOf(IDENTITY_TYPE_NAME);
    if (identityType === -1) {
        throw new Error(`Table's type table is missing "${IDENTITY_TYPE_NAME}" - refusing to guess an identity object type`);
    }
    const mint = () => {
        const uuid = new Uint8Array(randomBytes(16));
        const uuidIndex = pushUuid(doc, uuid);
        const ref = pushObject(doc, create(Document_DocObjectSchema, {
            custom: create(Document_CustomObjectSchema, {
                type: identityType,
                mapEntry: [
                    create(Document_CustomObject_MapEntrySchema, {
                        key: uuidIndexKey,
                        value: create(ObjectIDSchema, { unsignedIntegerValue: BigInt(uuidIndex) }),
                    }),
                ],
            }),
        }));
        return { ref, uuid };
    };
    const content = mint();
    const ordering = mint();
    return { orderingRef: ordering.ref, contentRef: content.ref, orderingUuid: ordering.uuid };
}
function insertRowAt(session, position, cellTexts) {
    const doc = session.doc;
    if (position > parseOrderedSet(doc, doc.crRowsRef).arrayUuidIndexes.length) {
        throw new Error(`Row insertion position ${position} is out of bounds`);
    }
    const stamp = elementStamp(session);
    const columnPositions = computePositions(doc, parseOrderedSet(doc, doc.crColumnsRef));
    const pair = mintIdentityPair(doc);
    insertIntoOrderedSet(session, doc.crRowsRef, position, pair, stamp);
    // One new content-keyed element (with a fresh cell) in every column's
    // row-map, at the column's visual position for the text lookup.
    for (const { a: columnRef, b: rowMapRef } of parseRefPairList(doc, doc.cellColumnsRef, "cellColumns")) {
        const columnPosition = columnPositions.get(uuidIndexOfRef(doc, resolveRef(columnRef, "cellColumns column ref")));
        if (columnPosition === undefined) {
            throw new Error("Table column reference does not resolve to a known column position");
        }
        const cellRef = pushCellText(session, cellTexts[columnPosition] ?? "");
        requireDictionary(doc, resolveRef(rowMapRef, "cellColumns row-map ref"), "column row-map").element.push(stampedDictionaryElement(pair.contentRef, cellRef, stamp));
    }
}
function insertColumnAt(session, position, cellTexts) {
    const doc = session.doc;
    if (position > parseOrderedSet(doc, doc.crColumnsRef).arrayUuidIndexes.length) {
        throw new Error(`Column insertion position ${position} is out of bounds`);
    }
    const stamp = elementStamp(session);
    const rowContentRefs = contentIdentityRefsByRowPosition(doc);
    const pair = mintIdentityPair(doc);
    insertIntoOrderedSet(session, doc.crColumnsRef, position, pair, stamp);
    const rowMapElements = rowContentRefs.map((rowContentRef, rowPosition) => stampedDictionaryElement(rowContentRef, pushCellText(session, cellTexts[rowPosition] ?? ""), stamp));
    const rowMapRef = pushObject(doc, create(Document_DocObjectSchema, { dictionary: create(DictionarySchema, { element: rowMapElements }) }));
    requireDictionary(doc, doc.cellColumnsRef, "cellColumns").element.push(stampedDictionaryElement(pair.contentRef, rowMapRef, stamp));
}
/** Each row's *content* identity ref, by visual position - read off the
 * existing row-maps' own keys (resolved through the redirect-aware position
 * map), since `crRows`' array lists the *ordering* identities and a new
 * column's row-map must key its cells the same way the existing ones do. */
function contentIdentityRefsByRowPosition(doc) {
    const rowPositions = computePositions(doc, parseOrderedSet(doc, doc.crRowsRef));
    const rowCount = parseOrderedSet(doc, doc.crRowsRef).arrayUuidIndexes.length;
    const refs = Array.from({ length: rowCount }, () => undefined);
    for (const { b: rowMapRef } of parseRefPairList(doc, doc.cellColumnsRef, "cellColumns")) {
        for (const { a: rowRef } of parseRefPairList(doc, resolveRef(rowMapRef, "cellColumns row-map ref"), "column row-map")) {
            const ref = resolveRef(rowRef, "row-map row ref");
            const position = rowPositions.get(uuidIndexOfRef(doc, ref));
            if (position !== undefined && refs[position] === undefined) {
                refs[position] = ref;
            }
        }
    }
    return refs.map((ref, position) => {
        if (ref === undefined) {
            throw new Error(`No existing row-map entry reveals row ${position}'s content identity - refusing to guess`);
        }
        return ref;
    });
}
function pushCellText(session, text) {
    const cell = newCellDocument();
    if (text.length > 0) {
        applyCellTextEdit(cell, text, session.textClock);
    }
    return pushObject(session.doc, create(Document_DocObjectSchema, { string: encodeCellDocument(cell) }));
}
function insertIntoOrderedSet(session, orderedSetRef, position, pair, stamp) {
    const orderedSet = requireOrderedSet(session.doc, orderedSetRef);
    const attachments = orderedSet.array.array.attachments;
    attachments.splice(position, 0, create(StringArray_ArrayAttachmentSchema, { attachmentIndex: 0n, contents: pair.orderingUuid }));
    renumberAttachments(orderedSet);
    // The FFFC mirror: splice one placeholder character in at the same
    // visual position, under our own document-global clock.
    editMirror(orderedSet, (mirror) => insertVisibleText(mirror, position, OBJECT_REPLACEMENT_CHARACTER, session.textClock));
    // The permanent ordering->content redirect, and the ordering identity's
    // set self-pair - both born with the row/column (dev log 2026-07-16T16:31).
    orderedSet.array.dictionary.element.push(stampedDictionaryElement(pair.orderingRef, pair.contentRef, stamp));
    orderedSet.set.element.push(stampedDictionaryElement(pair.orderingRef, pair.orderingRef, stamp));
}
// --- row/column deletion -------------------------------------------------
function deleteRowAt(session, position) {
    const doc = session.doc;
    const rowSet = parseOrderedSet(doc, doc.crRowsRef);
    if (position >= rowSet.arrayUuidIndexes.length) {
        throw new Error(`Row deletion position ${position} is out of bounds`);
    }
    if (rowSet.arrayUuidIndexes.length === 1) {
        throw new Error("Refusing to delete a table's last row");
    }
    // Captured before any mutation: a row-map's own entry for this row may
    // reference a different (but same-position) identity object than the one
    // `crRows`' array uses - the identity-pair split - so matching goes
    // through the redirect-aware position map, never raw identity.
    const rowPositions = computePositions(doc, rowSet);
    const freed = [];
    for (const { b: rowMapRef } of parseRefPairList(doc, doc.cellColumnsRef, "cellColumns")) {
        const dict = requireDictionary(doc, resolveRef(rowMapRef, "cellColumns row-map ref"), "column row-map");
        const index = dict.element.findIndex((el) => el.key !== undefined && rowPositions.get(uuidIndexOfRef(doc, resolveRef(el.key, "row-map row ref"))) === position);
        if (index !== -1) {
            const [removed] = dict.element.splice(index, 1);
            if (removed?.value) {
                freed.push(resolveRef(removed.value, "freed cell ref"));
            }
        }
    }
    removeFromOrderedSet(session, doc.crRowsRef, position);
    compactPool(doc, freed);
}
function deleteColumnAt(session, position) {
    const doc = session.doc;
    const columnSet = parseOrderedSet(doc, doc.crColumnsRef);
    if (position >= columnSet.arrayUuidIndexes.length) {
        throw new Error(`Column deletion position ${position} is out of bounds`);
    }
    if (columnSet.arrayUuidIndexes.length === 1) {
        throw new Error("Refusing to delete a table's last column");
    }
    const columnPositions = computePositions(doc, columnSet);
    const cellColumnsDict = requireDictionary(doc, doc.cellColumnsRef, "cellColumns");
    const index = cellColumnsDict.element.findIndex((el) => el.key !== undefined && columnPositions.get(uuidIndexOfRef(doc, resolveRef(el.key, "cellColumns column ref"))) === position);
    const freed = [];
    if (index !== -1) {
        const [removed] = cellColumnsDict.element.splice(index, 1);
        if (removed?.value) {
            const rowMapRef = resolveRef(removed.value, "cellColumns row-map ref");
            for (const { b: cellRef } of parseRefPairList(doc, rowMapRef, "column row-map")) {
                freed.push(resolveRef(cellRef, "freed cell ref"));
            }
            freed.push(rowMapRef);
        }
    }
    removeFromOrderedSet(session, doc.crColumnsRef, position);
    compactPool(doc, freed);
}
/** The ordering-side deletion recipe: drop the attachments entry and the
 * set self-pair, tombstone the mirror character (restamped under our style
 * clock, `tombstoneVisibleRange`), and retain the redirect entry and both
 * identity objects forever (dev log 2026-07-16T16:31; Apple's own
 * `CRTombstoneOrderedSet.delete` deletes from `elements` and calls
 * `TTArray.delete` - which tombstones the character - while leaving
 * `ordering.contents`, the redirect dictionary, alone). */
function removeFromOrderedSet(session, orderedSetRef, position) {
    const doc = session.doc;
    const orderedSet = requireOrderedSet(doc, orderedSetRef);
    const positions = computePositions(doc, parseOrderedSet(doc, orderedSetRef));
    markStructuralSave(session);
    orderedSet.array.array.attachments.splice(position, 1);
    renumberAttachments(orderedSet);
    editMirror(orderedSet, (mirror) => tombstoneVisibleRange(mirror, position, 1, session.textClock));
    const setDict = orderedSet.set;
    setDict.element = setDict.element.filter((el) => !(el.key !== undefined && positions.get(uuidIndexOfRef(doc, resolveRef(el.key, "set self-pair key"))) === position));
}
// --- OrderedSet plumbing ---------------------------------------------------
function requireOrderedSet(doc, poolRef) {
    const orderedSet = doc.objects[poolRef]?.tsOrderedSet;
    if (!orderedSet?.array?.array?.contents || !orderedSet.array.dictionary || !orderedSet.set) {
        throw new Error(`Table pool[${poolRef}] is not a well-formed OrderedSet`);
    }
    return orderedSet;
}
/** `attachmentIndex` is redundant with list position but Apple keeps it
 * sequential across splices, so every splice renumbers the whole list. */
function renumberAttachments(orderedSet) {
    orderedSet.array.array.attachments.forEach((attachment, index) => {
        attachment.attachmentIndex = BigInt(index);
    });
}
/** Runs one splice against the FFFC mirror (the same `topotext.String`
 * shape as a cell), then restores the mirror's own invariant shape: text =
 * one U+FFFC per live entry, one `{length: 1}` attribute run per visible
 * character (the exact captured shape). Child links are maintained by the
 * splice primitives themselves (`tableCellEdit.ts`). */
function editMirror(orderedSet, splice) {
    const stringArray = orderedSet.array.array;
    const mirror = parseCellDocument(stringArray.contents);
    splice(mirror);
    const visible = mirror.runs.filter((run) => !run.tombstone).reduce((sum, run) => sum + run.length, 0);
    mirror.text = OBJECT_REPLACEMENT_CHARACTER.repeat(visible);
    mirror.attributeRuns = Array.from({ length: visible }, () => create(AttributeRunSchema, { length: 1 }));
    validateCellInvariants(mirror);
    stringArray.contents = encodeCellDocument(mirror);
}
function requireDictionary(doc, poolRef, label) {
    const dictionary = doc.objects[poolRef]?.dictionary;
    if (!dictionary) {
        throw new Error(`Expected ${label} (pool[${poolRef}]) to be a dictionary`);
    }
    return dictionary;
}
// --- pool compaction -------------------------------------------------------
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
export function compactPool(doc, removedRefs) {
    if (removedRefs.length === 0) {
        return;
    }
    const removedSet = new Set(removedRefs);
    const remap = new Map();
    let shift = 0;
    for (let oldIndex = 0; oldIndex < doc.objects.length; oldIndex += 1) {
        if (removedSet.has(oldIndex)) {
            shift += 1;
            continue;
        }
        remap.set(oldIndex, oldIndex - shift);
    }
    // Skip entries about to be physically removed: their own internal
    // references (e.g. a freed row-map's references to the cell objects it
    // owned, also being freed alongside it) point at other removed indices
    // that were deliberately left out of `remap` - nothing needs to remap
    // them since the whole entry is going away regardless.
    doc.objects.forEach((entry, index) => {
        if (!removedSet.has(index)) {
            remapEntry(entry, remap);
        }
    });
    doc.crRowsRef = remapRequired(doc.crRowsRef, remap);
    doc.crColumnsRef = remapRequired(doc.crColumnsRef, remap);
    doc.cellColumnsRef = remapRequired(doc.cellColumnsRef, remap);
    for (const ref of [...removedSet].sort((a, b) => b - a)) {
        doc.objects.splice(ref, 1);
    }
}
function remapRequired(ref, remap) {
    const next = remap.get(ref);
    if (next === undefined) {
        throw new Error(`Pool compaction: reference to a removed pool index ${ref} - refusing to guess`);
    }
    return next;
}
/** Covers every `ObjectID`-bearing member the schema declares, including
 * the never-observed ones (`registerGreatest`, `oneof`, ... - cheap to
 * remap defensively rather than corrupt silently if one ever appears). */
function remapEntry(entry, remap) {
    for (const register of [entry.registerLatest, entry.registerGreatest, entry.registerLeast]) {
        if (register?.contents) {
            remapObjectId(register.contents, remap);
        }
    }
    for (const dictionary of [entry.set, entry.orderedSet, entry.dictionary]) {
        if (dictionary) {
            remapDictionary(dictionary, remap);
        }
    }
    if (entry.oneof) {
        for (const element of entry.oneof.element) {
            if (element.value) {
                remapObjectId(element.value, remap);
            }
        }
    }
    if (entry.custom) {
        for (const mapEntry of entry.custom.mapEntry) {
            if (mapEntry.value) {
                remapObjectId(mapEntry.value, remap);
            }
        }
    }
    if (entry.array?.dictionary) {
        remapDictionary(entry.array.dictionary, remap);
    }
    if (entry.tsOrderedSet) {
        if (entry.tsOrderedSet.array?.dictionary) {
            remapDictionary(entry.tsOrderedSet.array.dictionary, remap);
        }
        if (entry.tsOrderedSet.set) {
            remapDictionary(entry.tsOrderedSet.set, remap);
        }
    }
}
function remapDictionary(dictionary, remap) {
    for (const element of dictionary.element) {
        if (element.key) {
            remapObjectId(element.key, remap);
        }
        if (element.value) {
            remapObjectId(element.value, remap);
        }
        if (element.index?.contents) {
            remapObjectId(element.index.contents, remap);
        }
    }
}
function remapObjectId(id, remap) {
    if (!isFieldSet(id, OBJECT_INDEX_FIELD)) {
        return;
    }
    id.objectIndex = remapRequired(id.objectIndex, remap);
}
// --- structural invariants ---------------------------------------------------
/**
 * The machine-checkable slice of the table CRDT rulebook, verified against
 * every committed fixture (all 14 evolution revisions, all 10 write-path
 * revisions, both long-lived snapshots) before this engine was written -
 * run before and after every edit. The OrderedSet checks are the direct
 * regression test for both live corruption incidents: the first forgot the
 * mirror, the second broke the redirect/identity-pair join.
 */
export function validateTableDocumentInvariants(doc) {
    // A *populated* `startVersion` (CRDT.Document field 2) marks the blob as a
    // delta - the archived output of Apple's `CRDocument.deltaSince(since)`,
    // which carries only the objects changed since `since` rather than the
    // whole graph, and whose receiver answers `CRMergeResult.Fail` when that
    // baseline isn't dominated by its own version
    // (`mergeResultForMergingWithDocument`, web-client source). Every model in
    // this file assumes a full graph, and the byte round-trip gate would
    // faithfully preserve the marker, so an edited push would still claim to
    // be a delta. Refuse first and alone: a partial graph would fail most of
    // the checks below for reasons that say nothing about what's wrong.
    //
    // Presence alone is *not* the signal. Both long-lived fixtures carry an
    // empty `startVersion` (`12 00`) - the zero vector, dominated by every
    // version, which Apple never fails on - and refusing those would reject
    // real, editable tables.
    if ((doc.document.startVersion?.element.length ?? 0) > 0) {
        throw new Error("Table document carries a populated startVersion - it is a CRDT delta, not a full document, and this engine only edits full documents");
    }
    const failures = [];
    const replicaCount = doc.version.element.length;
    // The version vector: element i belongs to replica i.
    if (replicaCount === 0) {
        failures.push("version vector is empty");
    }
    doc.version.element.forEach((element, i) => {
        if (Number(element.replicaIndex) !== i) {
            failures.push(`version.element[${i}] claims replica ${element.replicaIndex}`);
        }
    });
    // The segmented UUID table: every identity object's index lands in the
    // identity segment.
    const uuidIndexKey = doc.keyNames.indexOf("UUIDIndex");
    for (const [ref, entry] of doc.objects.entries()) {
        if (!entry.custom || entry.custom.mapEntry.length !== 1) {
            continue;
        }
        const [mapEntry] = entry.custom.mapEntry;
        if (!mapEntry || mapEntry.key !== uuidIndexKey || !mapEntry.value || !isFieldSet(mapEntry.value, UNSIGNED_INTEGER_VALUE_FIELD)) {
            continue;
        }
        const index = Number(mapEntry.value.unsignedIntegerValue);
        if (index < replicaCount || index >= doc.uuidTable.length) {
            failures.push(`identity object r${ref} references UUID-table index ${index} outside the identity segment`);
        }
    }
    // Every element stamp is dominated by the document's version vector.
    const checkStamp = (label, timestamp) => {
        for (const element of timestamp?.element ?? []) {
            const known = doc.version.element[Number(element.replicaIndex)];
            if (!known) {
                failures.push(`${label}: stamped by replica ${element.replicaIndex}, not in the version vector`);
            }
            else if (element.clock > known.clock) {
                failures.push(`${label}: stamp clock ${element.clock} exceeds replica ${element.replicaIndex}'s vector clock ${known.clock}`);
            }
        }
    };
    doc.objects.forEach((entry, ref) => {
        for (const dictionary of [entry.set, entry.orderedSet, entry.dictionary]) {
            for (const element of dictionary?.element ?? []) {
                checkStamp(`r${ref} dictionary element`, element.timestamp);
            }
        }
        if (entry.tsOrderedSet) {
            for (const element of entry.tsOrderedSet.set?.element ?? []) {
                checkStamp(`r${ref} set element`, element.timestamp);
            }
            for (const element of entry.tsOrderedSet.array?.dictionary?.element ?? []) {
                checkStamp(`r${ref} redirect element`, element.timestamp);
            }
        }
    });
    // Per-axis OrderedSet consistency: the mirror, the attachment numbering,
    // the set self-pairs, and the redirect-resolved position map must all
    // agree on exactly which entries are live and where.
    for (const axisRef of [doc.crRowsRef, doc.crColumnsRef]) {
        const label = axisRef === doc.crRowsRef ? "crRows" : "crColumns";
        const orderedSet = doc.objects[axisRef]?.tsOrderedSet;
        const stringArray = orderedSet?.array?.array;
        if (!orderedSet || !stringArray?.contents) {
            failures.push(`${label}: not a well-formed OrderedSet`);
            continue;
        }
        const attachments = stringArray.attachments;
        const mirror = stringArray.contents;
        const visible = mirror.substring.filter((s) => !s.tombstone).reduce((sum, s) => sum + s.length, 0);
        if (visible !== attachments.length) {
            failures.push(`${label}: mirror visible length ${visible} != ${attachments.length} attachments`);
        }
        if (mirror.string !== OBJECT_REPLACEMENT_CHARACTER.repeat(attachments.length)) {
            failures.push(`${label}: mirror text isn't one U+FFFC per attachment`);
        }
        attachments.forEach((attachment, index) => {
            if (Number(attachment.attachmentIndex) !== index) {
                failures.push(`${label}: attachments[${index}] carries attachmentIndex ${attachment.attachmentIndex}`);
            }
        });
        let positions;
        try {
            positions = computePositions(doc, parseOrderedSet(doc, axisRef));
        }
        catch (cause) {
            failures.push(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
            continue;
        }
        const setPositions = [];
        for (const element of orderedSet.set?.element ?? []) {
            if (!element.key) {
                failures.push(`${label}: set self-pair with no key`);
                continue;
            }
            const position = positions.get(uuidIndexOfRef(doc, resolveRef(element.key, "set self-pair key")));
            if (position === undefined) {
                failures.push(`${label}: set self-pair references an entry with no live position`);
            }
            else {
                setPositions.push(position);
            }
        }
        if (new Set(setPositions).size !== attachments.length || setPositions.length !== attachments.length) {
            failures.push(`${label}: set self-pairs cover ${new Set(setPositions).size}/${setPositions.length} vs ${attachments.length} live entries`);
        }
    }
    // The content side resolves completely: every cellColumns/row-map key
    // lands on a live position and every live cell position has text.
    try {
        const resolved = resolveTable(doc);
        for (let row = 0; row < resolved.rows.length; row += 1) {
            for (let column = 0; column < resolved.columns.length; column += 1) {
                if (!resolved.cells.has(cellKey(row, column))) {
                    failures.push(`no cell object at row ${row}, column ${column}`);
                }
            }
        }
    }
    catch (cause) {
        failures.push(cause instanceof Error ? cause.message : String(cause));
    }
    // The topotext clock table is a sorted set (the Stage-1 doubling
    // incident's rule): entries in strict NSUUID order, and every CharID in
    // the document accounted for by its rank's clocks - run coordinates
    // within the text clock, style anchors within the style clock. Holds on
    // every committed fixture; a violation means chars would be attributed
    // to the wrong replica by Apple's incremental merge.
    const tt = doc.document.ttTimestamp;
    if (!tt) {
        failures.push("document has no topotext clock table (ttTimestamp)");
    }
    else {
        for (let i = 1; i < tt.clock.length; i += 1) {
            if (compareUuidBytes(tt.clock[i - 1].replicaUUID, tt.clock[i].replicaUUID) >= 0) {
                failures.push(`ttTimestamp entries ${i - 1} and ${i} are not in strict sorted UUID order`);
            }
        }
        const maxTextEnd = new Map();
        const maxStyleAnchor = new Map();
        for (const entry of doc.objects) {
            for (const str of [entry.string, entry.tsOrderedSet?.array?.array?.contents]) {
                for (const run of str?.substring ?? []) {
                    if (run.charID && run.charID.replicaID !== 0) {
                        const end = run.charID.clock + run.length;
                        maxTextEnd.set(run.charID.replicaID, Math.max(maxTextEnd.get(run.charID.replicaID) ?? 0, end));
                    }
                    if (run.timestamp && run.timestamp.replicaID !== 0) {
                        maxStyleAnchor.set(run.timestamp.replicaID, Math.max(maxStyleAnchor.get(run.timestamp.replicaID) ?? 0, run.timestamp.clock));
                    }
                }
            }
        }
        for (const [replicaId, end] of maxTextEnd) {
            const clock = tt.clock[replicaId - 1]?.replicaClock[0];
            if (!clock || end > Number(clock.clock)) {
                failures.push(`topotext replica ${replicaId}: run coordinates reach ${end}, beyond its text clock ${clock ? Number(clock.clock) : "(none)"}`);
            }
        }
        for (const [replicaId, anchor] of maxStyleAnchor) {
            const clock = tt.clock[replicaId - 1]?.replicaClock[1];
            if (!clock || anchor > Number(clock.clock)) {
                failures.push(`topotext replica ${replicaId}: style anchors reach ${anchor}, beyond its style clock ${clock ? Number(clock.clock) : "(none)"}`);
            }
        }
    }
    if (failures.length > 0) {
        throw new Error(`Table document violates structural invariants:\n  ${failures.join("\n  ")}`);
    }
}
//# sourceMappingURL=tableEdit.js.map