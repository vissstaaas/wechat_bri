/**
 * The shared outermost layer of every mergeable payload: a note body's
 * TextDataEncrypted and a table's MergeableDataEncrypted are both, once
 * decompressed, a `versioned_document.Document` whose single `Version.data`
 * holds the real payload (a `topotext.String` or a `CRDT.Document`
 * respectively - see `proto/versioned_document.proto`).
 *
 * Keeping `data` as opaque bytes at this layer (exactly as Apple declares
 * it) splits the byte-for-byte round-trip discipline cleanly: this wrapper
 * round-trips by construction as long as its own scalar fields do, and the
 * inner document is verified separately by its own parser's gate.
 */
import { type Document } from "./gen/versioned_document_pb.js";
export interface VersionedDocument {
    /** The decoded wrapper; `version[0].data` still holds the original bytes
     * until `encodeVersionedDocument` replaces them. */
    wrapper: Document;
    /** `version[0].data` - the serialized inner document. */
    data: Uint8Array;
}
/** Decodes the wrapper and requires the exactly-one-version shape every real
 * capture has - anything else means a document this project doesn't
 * understand, so refuse rather than guess which version wins. */
export declare function parseVersionedDocument(raw: Uint8Array): VersionedDocument;
/** Re-encodes the wrapper around a (possibly re-encoded) inner document,
 * preserving every other wrapper field verbatim. Mutates `doc` in place -
 * after this, `doc.data` and `wrapper.version[0].data` are `data`. */
export declare function encodeVersionedDocument(doc: VersionedDocument, data: Uint8Array): Uint8Array;
