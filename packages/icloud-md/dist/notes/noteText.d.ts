/**
 * Decodes the plain-text body of a note from its TextDataEncrypted field, as
 * returned by the read-side CloudKit APIs (records/query, records/lookup,
 * changes/zone). Despite the field name, this isn't client-side encrypted on
 * accounts without Advanced Data Protection - see README/dev notes. The bytes
 * are compressed protobuf in the same `versioned_document.Document` shape
 * used on-device in NoteStore.sqlite.
 *
 * The compression container isn't determined by which endpoint served the
 * record - it's whatever format the data happened to be stored in, which
 * depends on whichever client last wrote it (observed both gzip, magic
 * `1f 8b`, and zlib, magic `78 9c`, coming back from the exact same
 * `changes/zone` endpoint for different records). Both are tried.
 *
 * This only extracts the plain visible-text string (title + body, no
 * formatting) via `versioned_document.Version.data` -> `topotext.String
 * .string`, verified against real captured notes (see `proto/topotext.proto`).
 * Attribute runs (formatting, checklists, links, attachments) are
 * intentionally not parsed yet - out of scope until round-trip write support
 * needs them.
 */
export declare function decodeNoteBodyText(compressedProtobuf: Buffer): string;
/** The full decoded `topotext.String` - visible text plus attribute runs -
 * for callers that need formatting too (Step 2 of the formatting plan:
 * `classifyNoteRecord`'s render gate, `push`'s post-edit verification). */
export declare function decodeNoteString(compressedProtobuf: Buffer): import("./gen/topotext_pb.js").String;
export declare function decompressNoteDocument(buf: Buffer): Buffer;
/**
 * Compresses a rebuilt document for upload. The write path uses a zlib
 * container specifically: every `records/modify` body in the captured web
 * client traffic is zlib (magic `78 9c`), never gzip, so we match that.
 */
export declare function compressNoteDocument(raw: Uint8Array): Buffer;
