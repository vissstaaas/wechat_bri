/**
 * Typed model of the decompressed TextDataEncrypted "mergeable data" document
 * - the same protobuf `noteText.ts` reads note_text out of, but parsed
 * strictly enough to be *edited and re-encoded*, which is what `push` needs.
 *
 * Built on the generated `proto/topotext.proto`/`proto/versioned_document.proto`
 * schemas (protobuf-es). This project's own `NoteDocument`/`TextRun`/
 * `ReplicaEntry` stay plain domain types, decoupled from the generated
 * message shapes, so editing logic below doesn't need to think in
 * wire-format terms (their names predate the 2026-07-16 schema alignment
 * with Apple's recovered source: domain `TextRun` = wire `Substring`,
 * `coord` = `charID`, `anchor` = `Substring.timestamp`, `sequence` =
 * `child`, `ReplicaEntry` = `VectorTimestamp.Clock`). `AttributeRun` is the
 * one exception: it's a direct alias for the generated message type rather
 * than a separate wrapper, since Apple's formatting fields are numerous,
 * still mostly unused by this project (rendering them is out of scope until
 * a follow-on plan), and protobuf-es's own unknown-field retention already
 * makes preserving whatever we don't understand "nearly free" - see
 * `proto/topotext.proto` and the dev notes, 2026-07-15 (Step 1 spike).
 *
 * The shape here was derived empirically from real `records/modify` bodies
 * captured from www.icloud.com (see the project dev notes, 2026-07-13 "push
 * groundwork" entry), cross-checked against every note in those captures,
 * and since 2026-07-16 aligned with Apple's own recovered schema names
 * (dev log 2026-07-16T15:18):
 *
 *   versioned_document.Document > Version.data (see `versionedDocument.ts`)
 *   topotext.String:
 *              2: string (UTF-8; title is its first line)
 *              3: repeated Substring - the CRDT history of the string
 *              4: timestamp - per-replica clock table
 *                 (repeated { 1: 16-byte UUID, 2+: clocks })
 *              5: repeated AttributeRun - formatting spans over visible text
 *   Substring: 1: charID { 1: replica index, 2: clock }
 *              2: length
 *              3: timestamp (this file's domain `anchor`; Apple calls it the
 *                 run's style timestamp)
 *              4: tombstone flag (1 = deleted text, retained for merging)
 *              5: child run index(es) - genuinely `repeated`: a real capture
 *                 (2026-07-15) had two occurrences in one run; see
 *                 `proto/topotext.proto`'s `Substring.child` comment. This
 *                 file's domain model calls it `sequence`. These are real
 *                 DAG edges (0-based indexes into the substring array, each
 *                 pointing at a *child* run), not save-order sequence
 *                 numbers: Apple's serializer writes each substring's
 *                 in-memory `children` array as indexes, and its save order
 *                 is a Kahn-style topological traversal, so every edge
 *                 points forward in the array. Linear documents therefore
 *                 look renumbered 1..N (run k points at run k+1) - the
 *                 shape that previously misled this file into flattening
 *                 the graph on every push. Edits now preserve the graph,
 *                 doing the same edge surgery Apple's own client does
 *                 (`splitTopoSubstring_atIndex` /
 *                 `insertAttributedString_after_before`, recovered from the
 *                 captured iCloud web bundle - dev log 2026-08-02).
 *
 * Invariants verified against every captured note:
 *  - run lengths and clocks count UTF-16 code units;
 *  - visible text == concatenation of non-tombstoned runs, in list order;
 *  - each replica's clock in the table == total length it ever inserted;
 *  - replica indexes in coords are 1-based into the table (0 is reserved for
 *    the zero-length origin run and the (0, 0xFFFFFFFF) end sentinel);
 *  - attribute-run lengths sum to the visible text length.
 *
 * Everything this parser does not understand makes `parseNoteDocument` throw,
 * and `push` treats that note as read-only. On top of that, callers must
 * verify `encodeNoteDocument(parseNoteDocument(raw))` reproduces `raw`
 * byte-for-byte before trusting an edit - the round-trip gate from the
 * project README's Phase 3 plan. Unlike the pre-migration hand-rolled codec,
 * that gate is no longer just "did we understand every field" - protobuf-es
 * sorts declared fields by number and appends undeclared ones at the end on
 * encode, so it also silently catches "declared, but positioned somewhere
 * the schema doesn't yet account for" the same way it always caught
 * "not declared at all". A genuinely unrecognized field in the Note message
 * is therefore no longer rejected up front the way it used to be - it's
 * tolerated (preserved via protobuf-es's own unknown-field retention) and
 * only refused if the round-trip actually fails, which is strictly more
 * permissive without weakening the guarantee.
 */
import { type AttributeRun as GenAttributeRun, type Substring as GenSubstring } from "./gen/topotext_pb.js";
export interface RunCoord {
    replica: number;
    clock: number;
}
export interface TextRun {
    coord: RunCoord;
    length: number;
    anchor: RunCoord;
    tombstone: boolean;
    /** This run's outgoing child edges in the insertion-order DAG: 0-based
     * indexes into the document's runs array, always pointing at a *later*
     * index (Apple serializes in topological order). Usually one entry; more
     * on a branch node, where concurrent replicas inserted after the same run
     * (a real 2026-07-15 capture carries a two-child run) - see
     * `proto/topotext.proto`'s `Substring.child` comment. Maintained through
     * edits by `splitRunAt`/`insertRunAt`; the end sentinel has none. */
    sequence: number[];
}
export interface ReplicaEntry {
    id: Uint8Array;
    /** First entry is the replica's text clock (total UTF-16 units it has
     * inserted); later entries' meanings are unknown and preserved verbatim. */
    counters: number[];
}
/** Apple's formatting fields (paragraph style, fonts, colors, ...) - opaque
 * to this project's editing logic, which only ever reads/writes `.length`.
 * A direct alias for the generated message rather than a separate wrapper;
 * see file header. */
export type AttributeRun = GenAttributeRun;
export interface NoteDocument {
    /** `versioned_document.Document.serializationVersion`; always observed 0,
     * preserved verbatim. */
    rootSerializationVersion: number;
    /** `versioned_document.Version.serializationVersion`; always observed 0,
     * preserved verbatim. */
    versionSerializationVersion: number;
    /** `versioned_document.Version.minimumSupportedVersion`. */
    minimumSupportedVersion: number;
    text: string;
    runs: TextRun[];
    replicas: ReplicaEntry[];
    attributeRuns: AttributeRun[];
}
export declare function parseNoteDocument(raw: Uint8Array): NoteDocument;
export declare function encodeNoteDocument(doc: NoteDocument): Uint8Array;
/** The byte-for-byte round-trip gate: true only if we can reproduce `raw`
 * exactly from our parsed model, proving the model captured everything. */
export declare function noteDocumentRoundTrips(raw: Uint8Array): boolean;
export interface ApplyTextEditOptions {
    /** 16-byte replica UUID identifying this tool's edits in the CRDT. */
    replicaId: Uint8Array;
}
/**
 * Applies a plain-text edit to the document in place: the old and new text
 * are diffed into per-hunk splices (`computeSplices`), each removed visible
 * range is tombstoned - never physically deleted, other replicas need it to
 * merge - and each inserted piece becomes a new run (or extends our own
 * trailing run) with clocks from our replica's counter.
 *
 * Per-hunk rather than one spanning splice because the untouched text
 * BETWEEN two edits must keep its original runs and authorship: the
 * 2026-07-29 fusion investigation (vault dev log) caught the old
 * single-splice version tombstoning another replica's live runs and
 * re-authoring their text under our replica id merely because a second,
 * distant difference (a trailing newline) had destroyed the common suffix.
 * A device replica with unmerged history then revived its concurrently
 * edited runs alongside our re-authored copy, fusing the text.
 *
 * Returns false if the text is unchanged (nothing to push).
 */
export declare function applyTextEdit(doc: NoteDocument, newText: string, options: ApplyTextEditOptions): boolean;
/**
 * Builds the document for a brand-new note's very first save. A truly blank
 * document never crosses the wire - the captured create (see
 * har_captures/2026-07-16_note-lifecycle-create-table-delete.har, entry 2,
 * analyzed in the 2026-07-16T10:50 dev notes) is already an ordinary
 * one-replica document carrying the typed text - so this seeds the minimal
 * empty skeleton that capture implies (the zero-length replica-0 lead run,
 * the end sentinel, an empty replica table) and lets `applyTextEdit`, the
 * same machinery every push edit goes through, insert the actual content.
 *
 * One deliberate difference from the capture: no paragraph styling on the
 * first line (Apple's client styles it as a Title). Purely cosmetic - the
 * list-view title comes from the TitleEncrypted field, not from styling.
 */
export declare function buildInitialNoteDocument(text: string, replicaId: Uint8Array): NoteDocument;
/**
 * Splits `runs[index]` at `offset` (0 < offset < length) into head and tail
 * in place, exactly the edge surgery of Apple's `splitTopoSubstring_atIndex`:
 * the tail inherits the head's outgoing child edges, the head's only child
 * becomes the tail, and every edge that pointed at the split run keeps
 * pointing at the head (which keeps the run's coord, so edges by index stay
 * correct). The tail lands at `index + 1`; returns it. Exported for
 * `tableCellEdit.ts`, whose cell strings share the run discipline.
 */
export declare function splitRunAt(runs: TextRun[], index: number, offset: number): TextRun;
/**
 * Splices a freshly created `run` into the array at `index` and into the
 * child graph between its new array neighbours, mirroring Apple's
 * `insertAttributedString_after_before`: when the predecessor has an edge to
 * the run being displaced, the new run takes that edge's place
 * (predecessor -> new -> successor); when it doesn't (a branched graph where
 * the array neighbours aren't graph-linked), the new run takes over ALL of
 * the predecessor's children and becomes its only child. Exported for
 * `tableCellEdit.ts`.
 */
export declare function insertRunAt(runs: TextRun[], index: number, run: TextRun): void;
/** Exported for `tableCellEdit.ts`: a cell's `.string` field (field 10)
 * reuses this exact `Substring` message shape for its own CRDT run history. */
export declare function parseTextRun(run: GenSubstring): TextRun;
/** Exported for `tableCellEdit.ts`; see `parseTextRun`. */
export declare function encodeTextRun(run: TextRun): GenSubstring;
interface Splice {
    start: number;
    deleteLength: number;
    insertText: string;
}
/** Minimal single-splice diff over UTF-16 code units, never splitting a
 * surrogate pair. */
export declare function computeSplice(oldText: string, newText: string): Splice;
/**
 * Multi-hunk diff over UTF-16 code units: line-level LCS (node-diff3, the
 * same engine `mergeConflict.ts` merges with) locates each changed region,
 * then `computeSplice` tightens every hunk to character precision. Returned
 * splices carry non-overlapping, ascending `oldText` offsets.
 *
 * This is what keeps a push's CRDT edit minimal when the file differs from
 * the server text in more than one place (two edited paragraphs, or an edit
 * plus the markdown pipeline's trailing newline): only genuinely changed
 * characters are tombstoned/inserted, and everything between hunks keeps its
 * original runs and authorship - see `applyTextEdit`'s doc comment for the
 * fusion this prevents.
 */
export declare function computeSplices(oldText: string, newText: string): Splice[];
/**
 * Applies one formatting operation covering the given visible ranges, the
 * way Apple's client does (generateIdsForLocalChanges): every substring
 * overlapping a range - split at range boundaries - has its style timestamp
 * restamped with (us, max(its old style clock + 1, the pass's style-clock
 * floor)), and the replica's style clock (second counter) ends past the
 * highest stamp assigned. The caller is responsible for the attribute-run
 * rewrite the op corresponds to (`formatReconcile.ts`).
 */
export declare function applyFormattingOp(doc: NoteDocument, ranges: readonly {
    start: number;
    end: number;
}[], replicaId: Uint8Array): void;
/**
 * No delta check here, deliberately: `tableEdit.ts` refuses a document
 * carrying a populated `CRDT.Document.startVersion` (a partial graph from
 * Apple's `CRDocument.deltaSince`), but a note body isn't a `CRDT.Document`
 * at all - `TextDataEncrypted`'s wrapper holds a `topotext.String`
 * (`versionedDocument.ts`), whose schema has no delta marker: `string`,
 * `substring`, `timestamp`, `attributeRun`, and nothing that says "changes
 * since". The exposure is table-side only (audit, 2026-08-02).
 */
export declare function validateDocumentInvariants(doc: NoteDocument): void;
/**
 * Sanity for the child-edge graph (see `TextRun.sequence`): every edge in
 * range and strictly forward-pointing (Apple's save order is a topological
 * traversal, so any document its clients wrote satisfies this - and forward
 * edges can't form a cycle), and every non-sentinel run linked into the
 * graph (only the end sentinel is an end node in a non-fragment document).
 * Exported for `tableCellEdit.ts`'s cell/mirror variant of the discipline.
 */
export declare function validateChildEdges(runs: readonly TextRun[], what?: string): void;
/** Exported for `tableCellEdit.ts`; see `parseTextRun`. */
export declare function isSentinel(run: TextRun): boolean;
export declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
export {};
