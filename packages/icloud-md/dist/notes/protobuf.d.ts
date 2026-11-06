/**
 * Minimal protobuf wire-format reader - just enough to walk into a known field
 * path and pull out a length-delimited value, without a full schema/codegen
 * step. We don't have (or need, yet) a complete .proto for Apple's Notes
 * format; we only know the specific field-number path to note_text, verified
 * empirically against real captured note data (see databaseClient.ts callers
 * and the dev notes in projects/software/icloud-notes-sync.md).
 */
export type ProtoValue = {
    wireType: 0;
    varint: bigint;
} | {
    wireType: 1;
    fixed64: Uint8Array;
} | {
    wireType: 2;
    bytes: Uint8Array;
} | {
    wireType: 5;
    fixed32: Uint8Array;
};
/** One field occurrence in its original position - the unit of the ordered
 * (write-capable) API below, as opposed to the field-number-keyed map of
 * `readProtoFields`. */
export type ProtoToken = {
    fieldNumber: number;
} & ProtoValue;
export declare function readProtoFields(buf: Uint8Array): Map<number, ProtoValue[]>;
/** Returns the last (per proto semantics, latest wins for singular fields) length-delimited value for a field number. */
export declare function getLastBytesField(fields: Map<number, ProtoValue[]>, fieldNumber: number): Uint8Array | undefined;
/** Returns the last (latest wins) varint value for a field number. */
export declare function getLastVarintField(fields: Map<number, ProtoValue[]>, fieldNumber: number): bigint | undefined;
/**
 * Reads a message as an ordered token list, preserving the position of every
 * field occurrence. Re-encoding via `encodeProtoTokens` reproduces the
 * original bytes exactly (as long as the source used minimal varint
 * encodings, which callers verify with a byte-for-byte round-trip check
 * before ever trusting an edit built on top of this).
 */
export declare function readProtoTokens(buf: Uint8Array): ProtoToken[];
export declare function encodeProtoTokens(tokens: readonly ProtoToken[]): Uint8Array;
export declare function varintToken(fieldNumber: number, value: number | bigint): ProtoToken;
export declare function bytesToken(fieldNumber: number, bytes: Uint8Array): ProtoToken;
export declare function encodeVarint(value: bigint): Uint8Array;
