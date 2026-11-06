/**
 * Generic primitives for working with a `CRDT.Document` object pool - the
 * parallel arrays every mergeable data type shares (the object pool itself,
 * the key-name table, the UUID table, and the document's version vector) -
 * plus replica-aware version-vector stamps. Nothing here is table-specific;
 * `decodeTableRecord.ts`/`tableEdit.ts` are just this module's first caller.
 *
 * History note: this module originally carried the from-scratch-rebuild
 * helpers behind the abandoned table write engine rewrite
 * (`buildFreshOrderedSet`, `resetGenerationRegistry`, ... - see commit
 * d8fc0f2 and the Obsidian dev log's table write engine investigation for
 * that design and why it was dropped in favor of the incremental patch).
 *
 * On version vectors: `Document.version` is the document's vector clock -
 * element *i* belongs to replica *i* (`element[i].replicaIndex === i` in
 * every capture and fixture), and `Document.uuidItem[i]` is replica *i*'s
 * UUID (the UUID table is segmented: replica UUIDs first, one per version
 * element, then row/column identity UUIDs - dev log 2026-07-16T16:31). Each
 * `Dictionary.Element.timestamp` stamps that element with the vector time
 * of its *creation* - element stamps never evolve on later edits.
 */
import { type Dictionary_Element, type Document_DocObject, type ObjectID, type VectorTimestamp, type VectorTimestamp_Element } from "./gen/crdt_pb.js";
export interface MergeableDataPool {
    /** Pool objects, addressed by index ("ref N" throughout this codebase). */
    objects: Document_DocObject[];
    keyNames: string[];
    uuidTable: Uint8Array[];
    /**
     * `CRDT.Document.version` - the document's version vector (see file
     * header). Same message reference as the parsed document's own field -
     * mutate its `element` array in place (never reassign the message),
     * matching every other array on this interface.
     */
    version: VectorTimestamp;
}
export declare function pushObject(pool: MergeableDataPool, entry: Document_DocObject): number;
/** Throws rather than interning a new key name: edits only ever run against
 * a document just fetched and round-trip-verified, so every key name they
 * need (`identity`, `crRows`, `UUIDIndex`, etc.) is guaranteed already
 * present - refusing on a miss is safer than silently appending a key name
 * whose position elsewhere in the document we can't verify. */
export declare function requireKeyIndex(pool: MergeableDataPool, name: string): number;
export declare function pushUuid(pool: MergeableDataPool, uuid?: Uint8Array): number;
export declare function refTo(poolIndex: number): ObjectID;
/** One replica's logical time - the value side of a version-vector stamp. */
export interface VersionStamp {
    replicaIndex: number;
    clock: number;
}
/** A stamp element in the shape every real capture has for freshly created
 * elements: all three fields encoded explicitly (Apple's encoder writes the
 * zeros, and the round-trip gate depends on matching that). */
export declare function stampElement(stamp: VersionStamp): VectorTimestamp_Element;
export declare function stampVector(stamp: VersionStamp): VectorTimestamp;
/** Builds a `Dictionary.Element` carrying the given stamp as its creation
 * `timestamp` - `cellColumns` entries, row-map entries, `OrderedSet.set`
 * self-pairs, and redirect entries are all built from these. */
export declare function stampedDictionaryElement(keyRef: number, valueRef: number, stamp: VersionStamp): Dictionary_Element;
