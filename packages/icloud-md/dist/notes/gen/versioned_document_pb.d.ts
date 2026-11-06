import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file versioned_document.proto.
 */
export declare const file_versioned_document: GenFile;
/**
 * @generated from message versioned_document.Document
 */
export type Document = Message<"versioned_document.Document"> & {
    /**
     * Always observed 0; preserved verbatim, never interpreted.
     *
     * @generated from field: optional uint32 serializationVersion = 1;
     */
    serializationVersion: number;
    /**
     * Apple declares this repeated; every real capture has exactly one entry,
     * and the parsers refuse anything else rather than guess which version
     * wins (see `parseVersionedDocument`).
     *
     * @generated from field: repeated versioned_document.Version version = 2;
     */
    version: Version[];
};
/**
 * Describes the message versioned_document.Document.
 * Use `create(DocumentSchema)` to create a new message.
 */
export declare const DocumentSchema: GenMessage<Document>;
/**
 * @generated from message versioned_document.Version
 */
export type Version = Message<"versioned_document.Version"> & {
    /**
     * Always observed 0; preserved verbatim.
     *
     * @generated from field: optional uint32 serializationVersion = 1;
     */
    serializationVersion: number;
    /**
     * The previous schema called this `version` (note side: always 0 observed;
     * table side: small ints) - it's a minimum-supported-version marker, not a
     * revision counter.
     *
     * @generated from field: optional uint32 minimumSupportedVersion = 2;
     */
    minimumSupportedVersion: number;
    /**
     * A serialized `topotext.String` (note bodies) or `CRDT.Document`
     * (mergeable data). Kept as bytes for bit-perfect pass-through; the inner
     * parse is a separate layer.
     *
     * @generated from field: optional bytes data = 3;
     */
    data: Uint8Array;
};
/**
 * Describes the message versioned_document.Version.
 * Use `create(VersionSchema)` to create a new message.
 */
export declare const VersionSchema: GenMessage<Version>;
