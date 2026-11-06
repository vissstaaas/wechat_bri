import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Message } from "@bufbuild/protobuf";
/**
 * Describes the file topotext.proto.
 */
export declare const file_topotext: GenFile;
/**
 * A note body / cell text / ordering mirror. Previously `Note`.
 *
 * @generated from message topotext.String
 */
export type String = Message<"topotext.String"> & {
    /**
     * The visible text (title is its first line). Previously `note_text`.
     *
     * @generated from field: required string string = 2;
     */
    string: string;
    /**
     * The CRDT edit history behind `string`. Previously `TextRun text_run`.
     *
     * @generated from field: repeated topotext.Substring substring = 3;
     */
    substring: Substring[];
    /**
     * Per-replica clock table. Present on note bodies; absent on table cells
     * and ordering mirrors (confirmed via real captures - see
     * `tableCellEdit.ts`). Previously `ReplicaTable replica_table`.
     *
     * @generated from field: optional topotext.VectorTimestamp timestamp = 4;
     */
    timestamp?: VectorTimestamp | undefined;
    /**
     * Formatting spans over the visible text.
     *
     * @generated from field: repeated topotext.AttributeRun attributeRun = 5;
     */
    attributeRun: AttributeRun[];
};
/**
 * Describes the message topotext.String.
 * Use `create(StringSchema)` to create a new message.
 */
export declare const StringSchema: GenMessage<String>;
/**
 * A CRDT character coordinate. Previously `Coord {replica, clock}`.
 *
 * @generated from message topotext.CharID
 */
export type CharID = Message<"topotext.CharID"> & {
    /**
     * @generated from field: required uint32 replicaID = 1;
     */
    replicaID: number;
    /**
     * @generated from field: required uint32 clock = 2;
     */
    clock: number;
};
/**
 * Describes the message topotext.CharID.
 * Use `create(CharIDSchema)` to create a new message.
 */
export declare const CharIDSchema: GenMessage<CharID>;
/**
 * One run of the CRDT string history. Previously `TextRun`.
 *
 * @generated from message topotext.Substring
 */
export type Substring = Message<"topotext.Substring"> & {
    /**
     * @generated from field: required topotext.CharID charID = 1;
     */
    charID?: CharID | undefined;
    /**
     * Length in UTF-16 code units (surrogate pairs are two units).
     *
     * @generated from field: required uint32 length = 2;
     */
    length: number;
    /**
     * Previously `anchor`, semantics unknown at the time - Apple's schema
     * names it the run's *style timestamp*.
     *
     * @generated from field: required topotext.CharID timestamp = 3;
     */
    timestamp?: CharID | undefined;
    /**
     * Apple declares `bool`; kept as an integer so a value other than the
     * observed literal 1 is surfaced (and refused) rather than silently
     * squashed to `true` and re-encoded differently.
     *
     * @generated from field: optional uint32 tombstone = 4;
     */
    tombstone: number;
    /**
     * Previously `sequence`, semantics unknown at the time - Apple's schema
     * says it's an index into `String.substring` (a child-run link). Genuinely
     * `repeated`: a real 2026-07-15 capture had two occurrences in one run; a
     * proto2 `optional` would silently drop all but the last on decode.
     *
     * @generated from field: repeated uint32 child = 5;
     */
    child: number[];
};
/**
 * Describes the message topotext.Substring.
 * Use `create(SubstringSchema)` to create a new message.
 */
export declare const SubstringSchema: GenMessage<Substring>;
/**
 * Per-replica clock table. Previously `ReplicaTable {entry: ReplicaEntry}`.
 *
 * @generated from message topotext.VectorTimestamp
 */
export type VectorTimestamp = Message<"topotext.VectorTimestamp"> & {
    /**
     * @generated from field: repeated topotext.VectorTimestamp.Clock clock = 1;
     */
    clock: VectorTimestamp_Clock[];
};
/**
 * Describes the message topotext.VectorTimestamp.
 * Use `create(VectorTimestampSchema)` to create a new message.
 */
export declare const VectorTimestampSchema: GenMessage<VectorTimestamp>;
/**
 * @generated from message topotext.VectorTimestamp.Clock
 */
export type VectorTimestamp_Clock = Message<"topotext.VectorTimestamp.Clock"> & {
    /**
     * 16-byte replica UUID. Previously `uuid`.
     *
     * @generated from field: required bytes replicaUUID = 1;
     */
    replicaUUID: Uint8Array;
    /**
     * @generated from field: repeated topotext.VectorTimestamp.Clock.ReplicaClock replicaClock = 2;
     */
    replicaClock: VectorTimestamp_Clock_ReplicaClock[];
};
/**
 * Describes the message topotext.VectorTimestamp.Clock.
 * Use `create(VectorTimestamp_ClockSchema)` to create a new message.
 */
export declare const VectorTimestamp_ClockSchema: GenMessage<VectorTimestamp_Clock>;
/**
 * @generated from message topotext.VectorTimestamp.Clock.ReplicaClock
 */
export type VectorTimestamp_Clock_ReplicaClock = Message<"topotext.VectorTimestamp.Clock.ReplicaClock"> & {
    /**
     * First entry's clock is the replica's text clock (total UTF-16 units
     * it has inserted); later entries' meanings are still unknown and
     * preserved verbatim. Previously `ReplicaCounter.value`.
     *
     * @generated from field: required uint32 clock = 1;
     */
    clock: number;
    /**
     * Never observed set in this project's captures; `noteDocument.ts`
     * refuses a document that sets it rather than guess (its domain model
     * doesn't carry it through an edit).
     *
     * @generated from field: optional uint32 subclock = 2;
     */
    subclock: number;
};
/**
 * Describes the message topotext.VectorTimestamp.Clock.ReplicaClock.
 * Use `create(VectorTimestamp_Clock_ReplicaClockSchema)` to create a new message.
 */
export declare const VectorTimestamp_Clock_ReplicaClockSchema: GenMessage<VectorTimestamp_Clock_ReplicaClock>;
/**
 * @generated from message topotext.Color
 */
export type Color = Message<"topotext.Color"> & {
    /**
     * @generated from field: required float red = 1;
     */
    red: number;
    /**
     * @generated from field: required float green = 2;
     */
    green: number;
    /**
     * @generated from field: required float blue = 3;
     */
    blue: number;
    /**
     * @generated from field: required float alpha = 4;
     */
    alpha: number;
};
/**
 * Describes the message topotext.Color.
 * Use `create(ColorSchema)` to create a new message.
 */
export declare const ColorSchema: GenMessage<Color>;
/**
 * @generated from message topotext.AttachmentInfo
 */
export type AttachmentInfo = Message<"topotext.AttachmentInfo"> & {
    /**
     * @generated from field: optional string attachmentIdentifier = 1;
     */
    attachmentIdentifier: string;
    /**
     * @generated from field: optional string typeUTI = 2;
     */
    typeUTI: string;
    /**
     * Never observed; declared for field-ordering safety.
     *
     * @generated from field: optional string systemAttachmentClassName = 3;
     */
    systemAttachmentClassName: string;
    /**
     * @generated from field: optional bytes systemAttachmentData = 4;
     */
    systemAttachmentData: Uint8Array;
};
/**
 * Describes the message topotext.AttachmentInfo.
 * Use `create(AttachmentInfoSchema)` to create a new message.
 */
export declare const AttachmentInfoSchema: GenMessage<AttachmentInfo>;
/**
 * @generated from message topotext.Font
 */
export type Font = Message<"topotext.Font"> & {
    /**
     * Previously `font_name`.
     *
     * @generated from field: optional string name = 1;
     */
    name: string;
    /**
     * Previously `point_size`.
     *
     * @generated from field: optional float pointSize = 2;
     */
    pointSize: number;
    /**
     * Previously `font_hints`.
     *
     * @generated from field: optional uint32 fontHints = 3;
     */
    fontHints: number;
};
/**
 * Describes the message topotext.Font.
 * Use `create(FontSchema)` to create a new message.
 */
export declare const FontSchema: GenMessage<Font>;
/**
 * A checklist item's state. Previously `Checklist {uuid, done}`.
 *
 * @generated from message topotext.Todo
 */
export type Todo = Message<"topotext.Todo"> & {
    /**
     * @generated from field: required bytes todoUUID = 1;
     */
    todoUUID: Uint8Array;
    /**
     * Apple declares `bool`; kept integer - same reasoning as
     * `Substring.tombstone`.
     *
     * @generated from field: required uint32 done = 2;
     */
    done: number;
};
/**
 * Describes the message topotext.Todo.
 * Use `create(TodoSchema)` to create a new message.
 */
export declare const TodoSchema: GenMessage<Todo>;
/**
 * @generated from message topotext.ParagraphStyle
 */
export type ParagraphStyle = Message<"topotext.ParagraphStyle"> & {
    /**
     * Previously `style_type`.
     *
     * @generated from field: optional uint32 style = 1;
     */
    style: number;
    /**
     * Apple: enum Alignment {Left, Center, Right, Justified, Natural}.
     *
     * @generated from field: optional uint32 alignment = 2;
     */
    alignment: number;
    /**
     * Previously `unknown_field_3` (found via the 2026-07-15 round-trip
     * spike). Apple: enum WritingDirection {Natural, LTR, RTL, LTROverride,
     * RTLOverride}.
     *
     * @generated from field: optional uint32 writingDirection = 3;
     */
    writingDirection: number;
    /**
     * Previously `indent_amount`.
     *
     * @generated from field: optional int32 indent = 4;
     */
    indent: number;
    /**
     * Previously `checklist`.
     *
     * @generated from field: optional topotext.Todo todo = 5;
     */
    todo?: Todo | undefined;
    /**
     * Never observed; declared for field-ordering safety (an undeclared field
     * in the *middle* of a message re-emits after all declared ones - the
     * exact break the 2026-07-15 spike hit on what's now `writingDirection`).
     *
     * @generated from field: optional uint32 paragraphHints = 6;
     */
    paragraphHints: number;
    /**
     * @generated from field: optional uint32 startingListItemNumber = 7;
     */
    startingListItemNumber: number;
    /**
     * Previously `block_quote`.
     *
     * @generated from field: optional uint32 blockQuoteLevel = 8;
     */
    blockQuoteLevel: number;
    /**
     * Previously `unknown_field_9` ("looks like another 16-byte UUID" - it is
     * one).
     *
     * @generated from field: optional bytes uuid = 9;
     */
    uuid: Uint8Array;
};
/**
 * Describes the message topotext.ParagraphStyle.
 * Use `create(ParagraphStyleSchema)` to create a new message.
 */
export declare const ParagraphStyleSchema: GenMessage<ParagraphStyle>;
/**
 * @generated from message topotext.AttributeRun
 */
export type AttributeRun = Message<"topotext.AttributeRun"> & {
    /**
     * Length in UTF-16 code units.
     *
     * @generated from field: required uint32 length = 1;
     */
    length: number;
    /**
     * @generated from field: optional topotext.ParagraphStyle paragraphStyle = 2;
     */
    paragraphStyle?: ParagraphStyle | undefined;
    /**
     * Overrides bold/italic and paragraph styles.
     *
     * @generated from field: optional topotext.Font font = 3;
     */
    font?: Font | undefined;
    /**
     * Previously `font_weight` - Apple's schema says these are style modifier
     * bits (bold, italic, ...) applied on top of the paragraph style.
     *
     * @generated from field: optional uint32 fontHints = 5;
     */
    fontHints: number;
    /**
     * Previously `underlined`.
     *
     * @generated from field: optional uint32 underline = 6;
     */
    underline: number;
    /**
     * @generated from field: optional uint32 strikethrough = 7;
     */
    strikethrough: number;
    /**
     * @generated from field: optional int32 superscript = 8;
     */
    superscript: number;
    /**
     * @generated from field: optional string link = 9;
     */
    link: string;
    /**
     * @generated from field: optional topotext.Color color = 10;
     */
    color?: Color | undefined;
    /**
     * Never observed; Apple: enum WritingDirection (see ParagraphStyle).
     *
     * @generated from field: optional uint32 writingDirection = 11;
     */
    writingDirection: number;
    /**
     * @generated from field: optional topotext.AttachmentInfo attachmentInfo = 12;
     */
    attachmentInfo?: AttachmentInfo | undefined;
    /**
     * Previously `unknown_identifier`.
     *
     * @generated from field: optional uint64 timestamp = 13;
     */
    timestamp: bigint;
    /**
     * Previously `emphasis_style`.
     *
     * @generated from field: optional uint32 emphasis = 14;
     */
    emphasis: number;
    /**
     * Never observed; declared for field-ordering safety.
     *
     * @generated from field: optional topotext.AttachmentInfo systemAttachmentInfo = 15;
     */
    systemAttachmentInfo?: AttachmentInfo | undefined;
};
/**
 * Describes the message topotext.AttributeRun.
 * Use `create(AttributeRunSchema)` to create a new message.
 */
export declare const AttributeRunSchema: GenMessage<AttributeRun>;
