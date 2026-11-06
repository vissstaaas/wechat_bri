/**
 * Per-cell, identity-preserving text edits for a table's mergeable strings
 * (`Document.DocObject.string`, the same `topotext.String` message field 10
 * used elsewhere - see `decodeTableRecord.ts`'s file header). The same
 * splice/tombstone primitives also maintain an `OrderedSet`'s hidden
 * per-character U+FFFC ordering mirror (`tableEdit.ts`), which is the same
 * message type with the same run discipline.
 *
 * A cell's CRDT run history follows the exact same tombstone/splice
 * discipline as the top-level note body (`noteDocument.ts`), with one
 * structural difference confirmed against real captures (dev notes,
 * 2026-07-15T14:51 and 2026-07-16T16:31): the per-string clock table
 * (`String.timestamp`, field 4) is always absent. Instead, every mergeable
 * string in one table - every cell and both ordering mirrors - draws its
 * `CharID` clocks from one *document-global* per-replica sequence stored in
 * `CRDT.Document.ttTimestamp`, and `CharID.replicaID` is a 1-based index
 * into that table's `clock` entries (0 is the origin/sentinel
 * pseudo-replica). Callers therefore supply a `TopotextClockSource` wired to
 * the document's own clock table (see `tableEdit.ts`'s write session);
 * nothing in this module invents clock numbering of its own. (The previous
 * revision of this module borrowed replica index 1 with per-cell local
 * numbering - the exact workaround the 2026-07-16T16:31 evidence pass
 * existed to replace.)
 */
import { type AttributeRun, type TextRun } from "./noteDocument.js";
import { type String as GenString } from "./gen/topotext_pb.js";
/**
 * A table document's shared topotext clock, scoped to one replica: the
 * writing replica's 1-based `CharID.replicaID` and its two counters (the
 * text clock - total UTF-16 units this replica has ever inserted anywhere in
 * the document - and the style clock). `take` returns the first clock of a
 * fresh `units`-unit run and advances the text counter;
 * `takeTombstoneAnchor` returns the style timestamp to stamp on a run being
 * tombstoned and advances the style counter past it. `tableEdit.ts` backs
 * both with the document's own `ttTimestamp` entry so the advances persist
 * into the encoded document.
 */
export interface TopotextClockSource {
    readonly replicaIndex: number;
    take(units: number): number;
    /**
     * Apple's deletion-bias rule from `generateIdsForLocalChanges`:
     * `max(previousClock + 8, styleClockFloor)`, where the floor is this
     * replica's style clock as of the start of the save. The same rule
     * `noteDocument.ts` applies to note bodies (PR #9) - it is one shared
     * code path in Apple's client (`TTMergeableAttributedString`), so cells
     * and ordering mirrors obey it too.
     *
     * Both sides of that `max` are now checked against real Apple saves of a
     * real table (`realFixtures.ts`'s `TABLE_RESTYLE_REVISIONS`, captured
     * 2026-08-02): deleting a never-restyled run stamps 8 = max(0 + 8, floor
     * 1), and deleting a *bolded* one stamps 17 = max(9 + 8, floor 10) - the
     * old-anchor side, which nothing had exercised before that capture. It
     * also settles that table cells carry style anchors exactly as note
     * bodies do: bolding a cell restamps its live run at max(old + 1, floor).
     *
     * Apple has one other branch here, which this method deliberately does not
     * model: a run whose charID this replica minted *in the same save* is
     * stamped `{us, 0}` and leaves the style clock alone. Our writes apply one
     * splice per cell per save, so no edit can create and tombstone a run at
     * once - `tableEdit.test.ts` pins that across every supported edit type.
     */
    takeTombstoneAnchor(previousClock: number): number;
}
export interface TableCellDocument {
    text: string;
    runs: TextRun[];
    attributeRuns: AttributeRun[];
}
export declare function parseCellDocument(str: GenString): TableCellDocument;
export declare function encodeCellDocument(doc: TableCellDocument): GenString;
/** A brand-new empty cell, matching the exact shape every real capture has
 * for a freshly inserted cell (2026-07-16T16:31: an origin run, an end
 * sentinel, no attribute runs, nothing else); `applyCellTextEdit` gives it
 * real text under the caller's clock if the edit calls for any. */
export declare function newCellDocument(): TableCellDocument;
/**
 * Applies a plain-text edit to a cell in place, adapting
 * `noteDocument.ts`'s `applyTextEdit` splice/tombstone discipline with
 * clocks drawn from the document-global source - see file header. Returns
 * false if the text is unchanged (nothing to do).
 */
export declare function applyCellTextEdit(cell: TableCellDocument, newText: string, clock: TopotextClockSource): boolean;
/** Marks the visible range [start, start+length) as tombstoned, splitting
 * runs where the range boundaries fall inside one - identical algorithm to
 * `noteDocument.ts`'s `tombstoneVisibleRange`, operating on a cell instead
 * (`splitRunAt` owns the child-edge surgery; tombstoning itself never
 * touches edges). Every newly tombstoned piece is restamped
 * `{us, takeTombstoneAnchor(old style clock)}` so Apple's merge path sees
 * the deletion (it only adopts a remote tombstone when the remote style
 * timestamp compares strictly greater). Exported for `tableEdit.ts`'s mirror
 * maintenance; does not touch `text`/attribute runs (`applyCellTextEdit`
 * owns that for cells, the mirror helper owns it there). */
export declare function tombstoneVisibleRange(cell: TableCellDocument, start: number, length: number, clock: TopotextClockSource): void;
/** Inserts `text` at visible position `start` as a new run under the
 * caller's replica, drawing its clock range from the document-global
 * source (a cell edit is one splice per call - there's no cross-call "our
 * own trailing run" state worth tracking the way the top-level note body's
 * `insertVisibleText` does for consecutive saves). Fresh runs anchor at
 * `{ownReplica, 0}`, matching every captured insert. Exported for
 * `tableEdit.ts`'s mirror maintenance - same `text`/attribute-run caveat as
 * `tombstoneVisibleRange`. */
export declare function insertVisibleText(cell: TableCellDocument, start: number, text: string, clock: TopotextClockSource): void;
export declare function visibleLength(runs: readonly TextRun[]): number;
export declare function validateCellInvariants(cell: TableCellDocument): void;
