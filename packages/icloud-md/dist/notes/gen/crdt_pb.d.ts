import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { String, VectorTimestamp as VectorTimestamp$1 } from "./topotext_pb.js";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file crdt.proto.
 */
export declare const file_crdt: GenFile;
/**
 * A union of value shapes - real captures set exactly one member (a pool
 * ref via `objectIndex`, an inline number, or an inline string).
 *
 * @generated from message CRDT.ObjectID
 */
export type ObjectID = Message<"CRDT.ObjectID"> & {
    /**
     * Never observed. Note sint64: zigzag, not plain varint.
     *
     * @generated from field: optional sint64 integerValue = 1;
     */
    integerValue: bigint;
    /**
     * @generated from field: optional uint64 unsignedIntegerValue = 2;
     */
    unsignedIntegerValue: bigint;
    /**
     * Never observed.
     *
     * @generated from field: optional double doubleValue = 3;
     */
    doubleValue: number;
    /**
     * @generated from field: optional string stringValue = 4;
     */
    stringValue: string;
    /**
     * Never observed.
     *
     * @generated from field: optional bytes bytesValue = 5;
     */
    bytesValue: Uint8Array;
    /**
     * Index into `Document.object` ("ref N" throughout this codebase).
     *
     * @generated from field: optional uint32 objectIndex = 6;
     */
    objectIndex: number;
};
/**
 * Describes the message CRDT.ObjectID.
 * Use `create(ObjectIDSchema)` to create a new message.
 */
export declare const ObjectIDSchema: GenMessage<ObjectID>;
/**
 * A single replica's logical time. Previously `ListEntryDetailsKey
 * {list_entry_details_type_index, list_entry_details_key}`.
 *
 * @generated from message CRDT.Timestamp
 */
export type Timestamp = Message<"CRDT.Timestamp"> & {
    /**
     * @generated from field: optional uint64 replicaIndex = 1;
     */
    replicaIndex: bigint;
    /**
     * @generated from field: optional int64 counter = 2;
     */
    counter: bigint;
};
/**
 * Describes the message CRDT.Timestamp.
 * Use `create(TimestampSchema)` to create a new message.
 */
export declare const TimestampSchema: GenMessage<Timestamp>;
/**
 * Last-writer-wins register. Previously both `RegisterLatest` (the table's
 * column-direction marker) and `ListEntryDetails` - the two reverse-
 * engineered shapes were the same message all along.
 *
 * @generated from message CRDT.RegisterLatest
 */
export type RegisterLatest = Message<"CRDT.RegisterLatest"> & {
    /**
     * Previously `RegisterLatest.unknown_field_1` (opaque bytes).
     *
     * @generated from field: optional CRDT.Timestamp timestamp = 1;
     */
    timestamp?: Timestamp | undefined;
    /**
     * @generated from field: optional CRDT.ObjectID contents = 2;
     */
    contents?: ObjectID | undefined;
};
/**
 * Describes the message CRDT.RegisterLatest.
 * Use `create(RegisterLatestSchema)` to create a new message.
 */
export declare const RegisterLatestSchema: GenMessage<RegisterLatest>;
/**
 * A version vector: one element per replica. Previously the opaque
 * "generation-stamp registry" (`MergeableDataObjectData.unknown_field_1`,
 * repeated bytes) and each element's opaque 8-byte `generation_stamp` -
 * the "8-byte three-varint records" are exactly one `Element` each.
 *
 * @generated from message CRDT.VectorTimestamp
 */
export type VectorTimestamp = Message<"CRDT.VectorTimestamp"> & {
    /**
     * @generated from field: repeated CRDT.VectorTimestamp.Element element = 1;
     */
    element: VectorTimestamp_Element[];
};
/**
 * Describes the message CRDT.VectorTimestamp.
 * Use `create(VectorTimestampSchema)` to create a new message.
 */
export declare const VectorTimestampSchema: GenMessage<VectorTimestamp>;
/**
 * @generated from message CRDT.VectorTimestamp.Element
 */
export type VectorTimestamp_Element = Message<"CRDT.VectorTimestamp.Element"> & {
    /**
     * @generated from field: optional uint64 replicaIndex = 1;
     */
    replicaIndex: bigint;
    /**
     * @generated from field: optional uint64 clock = 2;
     */
    clock: bigint;
    /**
     * @generated from field: optional uint64 subclock = 3;
     */
    subclock: bigint;
};
/**
 * Describes the message CRDT.VectorTimestamp.Element.
 * Use `create(VectorTimestamp_ElementSchema)` to create a new message.
 */
export declare const VectorTimestamp_ElementSchema: GenMessage<VectorTimestamp_Element>;
/**
 * Previously `Dictionary {DictionaryElement element}`, and *also* previously
 * `List {ListEntry list_entry}` - Apple's schema revealed the field-5 "list"
 * payload is this same Dictionary message (see `Document.DocObject.orderedSet`).
 *
 * @generated from message CRDT.Dictionary
 */
export type Dictionary = Message<"CRDT.Dictionary"> & {
    /**
     * @generated from field: repeated CRDT.Dictionary.Element element = 1;
     */
    element: Dictionary_Element[];
};
/**
 * Describes the message CRDT.Dictionary.
 * Use `create(DictionarySchema)` to create a new message.
 */
export declare const DictionarySchema: GenMessage<Dictionary>;
/**
 * @generated from message CRDT.Dictionary.Element
 */
export type Dictionary_Element = Message<"CRDT.Dictionary.Element"> & {
    /**
     * Optional (unlike the old `DictionaryElement`'s required): the
     * dictionaries behind `DocObject.orderedSet` (field 5, the old `List`)
     * never set a key on the wire.
     *
     * @generated from field: optional CRDT.ObjectID key = 1;
     */
    key?: ObjectID | undefined;
    /**
     * @generated from field: required CRDT.ObjectID value = 2;
     */
    value?: ObjectID | undefined;
    /**
     * Previously `generation_stamp` (opaque 8-byte record): the vector time
     * of this element's last write.
     *
     * @generated from field: optional CRDT.VectorTimestamp timestamp = 3;
     */
    timestamp?: VectorTimestamp | undefined;
    /**
     * Previously `ListEntry.additional_details`.
     *
     * @generated from field: optional CRDT.RegisterLatest index = 4;
     */
    index?: RegisterLatest | undefined;
};
/**
 * Describes the message CRDT.Dictionary.Element.
 * Use `create(Dictionary_ElementSchema)` to create a new message.
 */
export declare const Dictionary_ElementSchema: GenMessage<Dictionary_Element>;
/**
 * Previously `MergeableDataObjectEntry.unknown_message = 9` (opaque bytes) -
 * even apple_cloud_notes_parser hadn't named it.
 *
 * @generated from message CRDT.Index
 */
export type Index = Message<"CRDT.Index"> & {
    /**
     * @generated from field: repeated CRDT.Index.Element element = 1;
     */
    element: Index_Element[];
};
/**
 * Describes the message CRDT.Index.
 * Use `create(IndexSchema)` to create a new message.
 */
export declare const IndexSchema: GenMessage<Index>;
/**
 * @generated from message CRDT.Index.Element
 */
export type Index_Element = Message<"CRDT.Index.Element"> & {
    /**
     * @generated from field: optional uint64 replicaIndex = 1;
     */
    replicaIndex: bigint;
    /**
     * @generated from field: optional int64 integer = 2;
     */
    integer: bigint;
};
/**
 * Describes the message CRDT.Index.Element.
 * Use `create(Index_ElementSchema)` to create a new message.
 */
export declare const Index_ElementSchema: GenMessage<Index_Element>;
/**
 * Never observed.
 *
 * @generated from message CRDT.OneOf
 */
export type OneOf = Message<"CRDT.OneOf"> & {
    /**
     * @generated from field: repeated CRDT.OneOf.Element element = 1;
     */
    element: OneOf_Element[];
};
/**
 * Describes the message CRDT.OneOf.
 * Use `create(OneOfSchema)` to create a new message.
 */
export declare const OneOfSchema: GenMessage<OneOf>;
/**
 * @generated from message CRDT.OneOf.Element
 */
export type OneOf_Element = Message<"CRDT.OneOf.Element"> & {
    /**
     * @generated from field: optional CRDT.ObjectID value = 1;
     */
    value?: ObjectID | undefined;
    /**
     * @generated from field: optional CRDT.Timestamp timestamp = 2;
     */
    timestamp?: Timestamp | undefined;
};
/**
 * Describes the message CRDT.OneOf.Element.
 * Use `create(OneOf_ElementSchema)` to create a new message.
 */
export declare const OneOf_ElementSchema: GenMessage<OneOf_Element>;
/**
 * An ordered list backed by a mergeable string: one attachment entry per
 * list position, mirrored by one U+FFFC character in `contents`. Previously
 * `OrderedSetOrderingArray {contents: Note, attachment}`.
 *
 * @generated from message CRDT.StringArray
 */
export type StringArray = Message<"CRDT.StringArray"> & {
    /**
     * @generated from field: required topotext.String contents = 1;
     */
    contents?: String | undefined;
    /**
     * @generated from field: repeated CRDT.StringArray.ArrayAttachment attachments = 2;
     */
    attachments: StringArray_ArrayAttachment[];
};
/**
 * Describes the message CRDT.StringArray.
 * Use `create(StringArraySchema)` to create a new message.
 */
export declare const StringArraySchema: GenMessage<StringArray>;
/**
 * @generated from message CRDT.StringArray.ArrayAttachment
 */
export type StringArray_ArrayAttachment = Message<"CRDT.StringArray.ArrayAttachment"> & {
    /**
     * Previously `index` (int32); redundant with list position, ignored on
     * read.
     *
     * @generated from field: required uint64 attachmentIndex = 1;
     */
    attachmentIndex: bigint;
    /**
     * Previously `uuid`: in every table capture, a 16-byte row/column
     * identity UUID (the join key into `Document.uuidItem`).
     *
     * @generated from field: required bytes contents = 2;
     */
    contents: Uint8Array;
};
/**
 * Describes the message CRDT.StringArray.ArrayAttachment.
 * Use `create(StringArray_ArrayAttachmentSchema)` to create a new message.
 */
export declare const StringArray_ArrayAttachmentSchema: GenMessage<StringArray_ArrayAttachment>;
/**
 * Previously `OrderedSetOrdering {array, contents}`.
 *
 * @generated from message CRDT.Array
 */
export type Array = Message<"CRDT.Array"> & {
    /**
     * @generated from field: required CRDT.StringArray array = 1;
     */
    array?: StringArray | undefined;
    /**
     * The identity-redirect dictionary: resolves stale/duplicate identities
     * from concurrent edits onto their canonical counterpart. Previously
     * `OrderedSetOrdering.contents`.
     *
     * @generated from field: required CRDT.Dictionary dictionary = 2;
     */
    dictionary?: Dictionary | undefined;
};
/**
 * Describes the message CRDT.Array.
 * Use `create(ArraySchema)` to create a new message.
 */
export declare const ArraySchema: GenMessage<Array>;
/**
 * Previously `OrderedSet {ordering, elements}` (the `crRows`/`crColumns`
 * shape, `DocObject.tsOrderedSet` = old field-16 `ordered_set`).
 *
 * @generated from message CRDT.OrderedSet
 */
export type OrderedSet = Message<"CRDT.OrderedSet"> & {
    /**
     * @generated from field: required CRDT.Array array = 1;
     */
    array?: Array | undefined;
    /**
     * One trivial `{key: ref, value: ref}` self-pair per live array entry.
     * Previously `elements`.
     *
     * @generated from field: required CRDT.Dictionary set = 2;
     */
    set?: Dictionary | undefined;
};
/**
 * Describes the message CRDT.OrderedSet.
 * Use `create(OrderedSetSchema)` to create a new message.
 */
export declare const OrderedSetSchema: GenMessage<OrderedSet>;
/**
 * The object-pool document. Previously `MergeableDataObjectData`.
 *
 * @generated from message CRDT.Document
 */
export type Document = Message<"CRDT.Document"> & {
    /**
     * The document's version vector. Previously `unknown_field_1` (repeated
     * opaque bytes; the single observed occurrence's "concatenated 8-byte
     * records" are this message's repeated `element` entries).
     *
     * @generated from field: optional CRDT.VectorTimestamp version = 1;
     */
    version?: VectorTimestamp | undefined;
    /**
     * Previously `unknown_field_2` - observed only as a present-but-empty
     * message (`12 00`) on long-lived tables.
     *
     * @generated from field: optional CRDT.VectorTimestamp startVersion = 2;
     */
    startVersion?: VectorTimestamp | undefined;
    /**
     * The object pool, addressed by index via `ObjectID.objectIndex`.
     * Previously `mergeable_data_object_entry`.
     *
     * @generated from field: repeated CRDT.Document.DocObject object = 3;
     */
    object: Document_DocObject[];
    /**
     * Previously `mergeable_data_object_key_item`.
     *
     * @generated from field: repeated string keyItem = 4;
     */
    keyItem: string[];
    /**
     * Previously `mergeable_data_object_type_item`.
     *
     * @generated from field: repeated string typeItem = 5;
     */
    typeItem: string[];
    /**
     * 16-byte UUIDs, plain-index addressed. Previously
     * `mergeable_data_object_uuid_item`.
     *
     * @generated from field: repeated bytes uuidItem = 6;
     */
    uuidItem: Uint8Array[];
    /**
     * Previously `unknown_field_7` - the 2/4 hand-decode ({replica UUID,
     * clock, clock} per replica) matches this declaration byte-for-byte.
     *
     * @generated from field: optional topotext.VectorTimestamp ttTimestamp = 7;
     */
    ttTimestamp?: VectorTimestamp$1 | undefined;
};
/**
 * Describes the message CRDT.Document.
 * Use `create(DocumentSchema)` to create a new message.
 */
export declare const DocumentSchema: GenMessage<Document>;
/**
 * A typed key/value object. Previously `MergeableDataObjectMap`.
 *
 * @generated from message CRDT.Document.CustomObject
 */
export type Document_CustomObject = Message<"CRDT.Document.CustomObject"> & {
    /**
     * Index into `Document.typeItem`.
     *
     * @generated from field: required int32 type = 1;
     */
    type: number;
    /**
     * @generated from field: repeated CRDT.Document.CustomObject.MapEntry mapEntry = 3;
     */
    mapEntry: Document_CustomObject_MapEntry[];
};
/**
 * Describes the message CRDT.Document.CustomObject.
 * Use `create(Document_CustomObjectSchema)` to create a new message.
 */
export declare const Document_CustomObjectSchema: GenMessage<Document_CustomObject>;
/**
 * @generated from message CRDT.Document.CustomObject.MapEntry
 */
export type Document_CustomObject_MapEntry = Message<"CRDT.Document.CustomObject.MapEntry"> & {
    /**
     * Index into `Document.keyItem`.
     *
     * @generated from field: required int32 key = 1;
     */
    key: number;
    /**
     * @generated from field: required CRDT.ObjectID value = 2;
     */
    value?: ObjectID | undefined;
};
/**
 * Describes the message CRDT.Document.CustomObject.MapEntry.
 * Use `create(Document_CustomObject_MapEntrySchema)` to create a new message.
 */
export declare const Document_CustomObject_MapEntrySchema: GenMessage<Document_CustomObject_MapEntry>;
/**
 * One pool object - a union; real entries set exactly one member.
 * Previously `MergeableDataObjectEntry`.
 *
 * @generated from message CRDT.Document.DocObject
 */
export type Document_DocObject = Message<"CRDT.Document.DocObject"> & {
    /**
     * @generated from field: optional CRDT.RegisterLatest registerLatest = 1;
     */
    registerLatest?: RegisterLatest | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.RegisterLatest registerGreatest = 2;
     */
    registerGreatest?: RegisterLatest | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.RegisterLatest registerLeast = 3;
     */
    registerLeast?: RegisterLatest | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.Dictionary set = 4;
     */
    set?: Dictionary | undefined;
    /**
     * Previously `List list = 5` - it's a Dictionary on the wire (see
     * `Dictionary`'s comment).
     *
     * @generated from field: optional CRDT.Dictionary orderedSet = 5;
     */
    orderedSet?: Dictionary | undefined;
    /**
     * @generated from field: optional CRDT.Dictionary dictionary = 6;
     */
    dictionary?: Dictionary | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.Timestamp timestamp = 7;
     */
    timestamp?: Timestamp | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.VectorTimestamp vectorTimestamp = 8;
     */
    vectorTimestamp?: VectorTimestamp | undefined;
    /**
     * Previously `unknown_message` (opaque bytes).
     *
     * @generated from field: optional CRDT.Index index = 9;
     */
    index?: Index | undefined;
    /**
     * A cell-text / mergeable-string object. Previously `note`.
     *
     * @generated from field: optional topotext.String string = 10;
     */
    string?: String | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional uint64 weakReference = 11;
     */
    weakReference: bigint;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.OneOf oneof = 12;
     */
    oneof?: OneOf | undefined;
    /**
     * Previously `custom_map`.
     *
     * @generated from field: optional CRDT.Document.CustomObject custom = 13;
     */
    custom?: Document_CustomObject | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.StringArray stringArray = 14;
     */
    stringArray?: StringArray | undefined;
    /**
     * Never observed.
     *
     * @generated from field: optional CRDT.Array array = 15;
     */
    array?: Array | undefined;
    /**
     * Previously `ordered_set`.
     *
     * @generated from field: optional CRDT.OrderedSet tsOrderedSet = 16;
     */
    tsOrderedSet?: OrderedSet | undefined;
};
/**
 * Describes the message CRDT.Document.DocObject.
 * Use `create(Document_DocObjectSchema)` to create a new message.
 */
export declare const Document_DocObjectSchema: GenMessage<Document_DocObject>;
