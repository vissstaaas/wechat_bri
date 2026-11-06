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
import { randomBytes } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { ObjectIDSchema, VectorTimestampSchema, VectorTimestamp_ElementSchema, Dictionary_ElementSchema, } from "./gen/crdt_pb.js";
// --- pool object / key-name / UUID helpers ---------------------------------
export function pushObject(pool, entry) {
    pool.objects.push(entry);
    return pool.objects.length - 1;
}
/** Throws rather than interning a new key name: edits only ever run against
 * a document just fetched and round-trip-verified, so every key name they
 * need (`identity`, `crRows`, `UUIDIndex`, etc.) is guaranteed already
 * present - refusing on a miss is safer than silently appending a key name
 * whose position elsewhere in the document we can't verify. */
export function requireKeyIndex(pool, name) {
    const index = pool.keyNames.indexOf(name);
    if (index === -1) {
        throw new Error(`Table's key-name table is missing "${name}" - refusing to guess its index`);
    }
    return index;
}
export function pushUuid(pool, uuid = new Uint8Array(randomBytes(16))) {
    pool.uuidTable.push(uuid);
    return pool.uuidTable.length - 1;
}
export function refTo(poolIndex) {
    return create(ObjectIDSchema, { objectIndex: poolIndex });
}
/** A stamp element in the shape every real capture has for freshly created
 * elements: all three fields encoded explicitly (Apple's encoder writes the
 * zeros, and the round-trip gate depends on matching that). */
export function stampElement(stamp) {
    return create(VectorTimestamp_ElementSchema, {
        replicaIndex: BigInt(stamp.replicaIndex),
        clock: BigInt(stamp.clock),
        subclock: 0n,
    });
}
export function stampVector(stamp) {
    return create(VectorTimestampSchema, { element: [stampElement(stamp)] });
}
/** Builds a `Dictionary.Element` carrying the given stamp as its creation
 * `timestamp` - `cellColumns` entries, row-map entries, `OrderedSet.set`
 * self-pairs, and redirect entries are all built from these. */
export function stampedDictionaryElement(keyRef, valueRef, stamp) {
    return create(Dictionary_ElementSchema, {
        key: refTo(keyRef),
        value: refTo(valueRef),
        timestamp: stampVector(stamp),
    });
}
//# sourceMappingURL=mergeableDataPool.js.map