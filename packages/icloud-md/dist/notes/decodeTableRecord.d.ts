/**
 * Reads and writes a table's `MergeableDataEncrypted` payload (an
 * `Attachment` record whose `UTI` is `com.apple.notes.table`) - a
 * GitHub-flavored-Markdown pipe table on one side, the object-pool CRDT
 * structure Apple's client uses on the other.
 *
 * The structure was reverse-engineered from real captures, cross-checked
 * against threeplanetssoftware/apple_cloud_notes_parser's
 * `AppleNotesEmbeddedTable.rb` (MIT licensed) - see the project dev notes,
 * "Consolidated reference: the complete `com.apple.notes.table`
 * MergeableData structure" (2026-07-14T14:46) and "Table write path planned
 * end-to-end" (2026-07-15T14:51) - and since 2026-07-16 aligned with
 * Apple's own recovered schema names (dev log 2026-07-16T15:18); see
 * `proto/crdt.proto` for the generated-schema field names used below and
 * the old-name -> Apple-name mapping.
 *
 * Shape, once decompressed the same way `decompressNoteDocument` does:
 *
 *   versioned_document.Document > Version.data (see `versionedDocument.ts`)
 *   CRDT.Document
 *     .object[]    object pool (`DocObject`s), addressed by index everywhere
 *                  else via an ObjectID's `objectIndex` ("ref N" below)
 *     .keyItem[]   key-name table (strings)
 *     .uuidItem[]  UUID table (16-byte UUIDs, plain-index addressed)
 *     .version     the document's version vector (see `mergeableDataPool.ts`)
 *
 * `pool[0]` is the table object: a `custom` object (field 13), repeated
 * `MapEntry { key: key-table-index, value: ObjectID }` pairs, with keys
 * `crRows`, `crColumns`, `cellColumns` (each a ref) resolved via the
 * key-name table.
 *
 * `crRows`/`crColumns` are `tsOrderedSet` objects (field 16): `.array.array`
 * (a `StringArray`) is the true visual-order list - its `.attachments[]` are
 * the ordered `{attachmentIndex (redundant, ignored on read), contents (a
 * 16-byte identity UUID)}` entries, list position = visual position; its
 * `.contents` is a hidden per-character CRDT mirror of that same list (one
 * U+FFFC per entry) that Apple's client uses for concurrent-insert merge
 * resolution - our own decode never reads it (position comes from
 * `attachments` order), but every edit `tableEdit.ts` makes maintains it by
 * real topotext splice, because *not* maintaining it is exactly what
 * corrupted a live table under the first write-path design (dev notes,
 * 2026-07-15T21:54 and 2026-07-16T16:31).
 * `.array.dictionary` is the identity-redirect `Dictionary` permanently
 * joining each entry's *ordering* identity to its *content* identity (see
 * the identity-pair paragraph below) - not an order signal itself, though
 * `computePositions` follows it so stale references resolve.
 * `.set` (of `OrderedSet` itself) is a `Dictionary` of trivial
 * `{key: ref, value: ref}` self-pairs, one per live `attachments` entry
 * (confirmed via real captures) - membership bookkeeping this project's
 * decode never reads, kept in sync on every structural edit by
 * `tableEdit.ts`.
 *
 * A row/column identity object is a `custom` object (`type` 2, confirmed via
 * real captures) with exactly one entry, key `UUIDIndex`, value a plain
 * inline number (`ObjectID.unsignedIntegerValue`) - the index into the
 * document-level UUID table. This value, not the object's own pool position,
 * is the join key used everywhere below. Every row/column is born as an
 * identity *pair* - an ordering identity (listed in `attachments`,
 * self-paired in `set`) and a content identity (keying `cellColumns`/
 * row-map entries), joined by a `.array.dictionary` redirect entry - a
 * structural fact of the format from the literal first save, not
 * concurrent-edit residue as this file's earlier revisions guessed (dev
 * notes 2026-07-16T16:31); `tableEdit.ts`'s inserts mint real pairs
 * accordingly. Deletion retains both identity objects and the redirect
 * forever, which is why long-lived tables carry identities no live position
 * references.
 *
 * `cellColumns` is a `dictionary` (field 6), repeated `Dictionary.Element
 * {key: ref to a column identity object, value: ref to that column's
 * row-map object}`. A row-map object has the identical shape: `{key: ref to
 * a row identity object, value: ref to a cell-text object}`. A cell-text
 * object is a `string` (a `topotext.String`, field 10) whose `.string` is
 * the literal cell text - the ground truth this project's decode reads
 * directly, rather than reconstructing visible text from `substring` history
 * the way the top-level note body's decode does (see `tableCellEdit.ts` for
 * why edits still have to maintain that history correctly regardless).
 *
 * Row 0 is not structurally special: deleting the header row goes through
 * the exact same mechanism as any other row (confirmed via a real capture,
 * dev notes 2026-07-15T14:51) - it's rendered as a GFM header row purely
 * because GFM pipe tables require one syntactically.
 */
import type { MergeableDataPool } from "./mergeableDataPool.js";
import { type Document as CrdtDocument, type Document_DocObject as DocObject, type ObjectID } from "./gen/crdt_pb.js";
import { type VersionedDocument } from "./versionedDocument.js";
export declare const OBJECT_INDEX_FIELD: import("@bufbuild/protobuf").DescField;
export declare const UNSIGNED_INTEGER_VALUE_FIELD: import("@bufbuild/protobuf").DescField;
/** Same shape as `mergeableDataPool.ts`'s generic `MergeableDataPool` - kept
 * as its own name here since most of this file's own history predates that
 * module, but it's the same type, not a parallel one. Every array is the
 * same reference as `TableDocument.message`'s own fields - mutating in
 * place (never reassigning) is what keeps `TableDocument.message` and this
 * pool consistent through edits. */
export type TablePool = MergeableDataPool;
/** A parsed, editable table document: the outer `versioned_document` wrapper
 * (kept so re-encoding preserves it verbatim), the inner `CRDT.Document`
 * protobuf message (mutable in place via `@bufbuild/protobuf`'s `create`),
 * plus the three top-level pool refs every table-editing operation needs.
 * Deliberately does *not* cache a resolved rows/columns/cells snapshot as
 * document fields - those go stale the moment a structural edit runs, which
 * is every edit `tableEdit.ts` makes; `resolveTable` below computes a fresh
 * one on demand instead. */
export interface TableDocument extends TablePool {
    wrapper: VersionedDocument;
    document: CrdtDocument;
    crRowsRef: number;
    crColumnsRef: number;
    cellColumnsRef: number;
}
export interface TableRowColumn {
    /** Pool index of this row/column's identity object. */
    identityRef: number;
    /** Index into the document UUID table - the join key used everywhere else. */
    uuidIndex: number;
}
export interface TableCell {
    /** Pool index of the cell-text object (a `note`, field 10). */
    textRef: number;
    text: string;
}
export interface ResolvedTable {
    /** Rows/columns, in true visual order. */
    rows: TableRowColumn[];
    columns: TableRowColumn[];
    /** Keyed `${rowUuidIndex},${columnUuidIndex}`. */
    cells: Map<string, TableCell>;
}
export declare function decodeTableMarkdown(compressedMergeableData: Buffer): string;
export declare function gridFromTableDocument(doc: TableDocument): string[][];
/** Keys `ResolvedTable.cells` by *position* (index into `ResolvedTable.rows`/
 * `.columns`), not by UUID-table index - real captures occasionally have a
 * row/column identity referenced by `cellColumns` that differs from the one
 * referenced by `crRows`/`crColumns`' own `OrderedSet.array` for the exact
 * same visual row/column (see `decodeTableRecord.ts`'s file header on
 * identity-pair residue), reconciled only via `computePositions`' redirect
 * following - so position, not raw identity, is the only key that's
 * guaranteed consistent between `resolveTable`'s two passes. */
export declare function cellKey(rowPosition: number, columnPosition: number): string;
export declare function parseTableDocument(compressedMergeableData: Buffer): TableDocument;
/** `parseTableDocument` + `toBinary`/compress - always reflects `doc.document`
 * as currently mutated, since `doc.objects`/`.keyNames`/`.uuidTable` are the
 * same array references embedded in it. */
export declare function encodeTableDocument(doc: TableDocument): Buffer;
/** The byte-for-byte round-trip gate over the *decompressed* bytes, same
 * discipline as `noteDocumentRoundTrips` - the compressed container isn't
 * compared, since re-deflating isn't guaranteed byte-stable and isn't what
 * we're actually verifying (whether our model captured everything). */
export declare function tableDocumentRoundTrips(compressedMergeableData: Buffer): boolean;
export declare function resolveTable(doc: TableDocument): ResolvedTable;
/** Finds a row/column's identity object by UUID-table index. Every entry in
 * an `OrderedSet.array` is guaranteed to resolve (that's how
 * `computePositions`/`uuidIndexOfRef` establish the position map in the
 * first place), so this re-scans the pool once per row/column - fine at
 * table sizes this project has ever seen. Exported for `tableEdit.ts`: real
 * captures occasionally have more than one identity object sharing the same
 * UUID-table index (apparently residue from Apple's own concurrent-edit
 * history - see the file header); this always returns the *first* match,
 * but every caller here and in `tableEdit.ts` treats row/column identity by
 * UUID-table index throughout, never by raw pool ref, so which specific
 * duplicate this resolves to never matters. */
export declare function identityOf(pool: TablePool, uuidIndex: number): TableRowColumn;
/** Resolves a `custom` object (a `CustomObject`, field 13) into its
 * key-name -> ObjectID pairs. Exported for `tableEdit.ts`: rebuilding
 * pool[0] from scratch needs to read its current `identity`/
 * `crTableColumnDirection` entries first. */
export declare function parseDictByName(pool: TablePool, entry: DocObject, label: string): Map<string, ObjectID>;
export declare function requireEntry(dict: Map<string, ObjectID>, key: string): ObjectID;
/** Resolves an `ObjectID` known to be a pool reference (`objectIndex`). */
export declare function resolveRef(objectId: ObjectID, label: string): number;
/** A row/column identity object: a one-entry dict, key `UUIDIndex`. Exported
 * for `tableEdit.ts`. */
export declare function uuidIndexOfRef(pool: TablePool, poolRef: number): number;
export interface ParsedOrderedSet {
    /** Document-UUID-table indexes, in true visual order. */
    arrayUuidIndexes: number[];
    /** Stale-identity redirects: value's position should mirror key's. */
    contents: Array<{
        keyRef: number;
        valueRef: number;
    }>;
}
export declare function parseOrderedSet(pool: TablePool, poolRef: number): ParsedOrderedSet;
export declare function computePositions(pool: TablePool, orderedSet: ParsedOrderedSet): Map<number, number>;
/** `cellColumns` and each column's row-map share the same `dictionary`
 * (field 6), repeated `Dictionary.Element {key: ref, value: ref}` shape. */
export declare function parseRefPairList(pool: TablePool, poolRef: number, label: string): Array<{
    a: ObjectID;
    b: ObjectID;
}>;
export declare function resolveCellText(pool: TablePool, poolRef: number): string;
export declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
