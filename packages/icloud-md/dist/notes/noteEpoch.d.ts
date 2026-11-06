export interface NoteEpoch {
    id: string;
    timestamp: string;
    noteRecordName: string;
    /**
     * Maps every record associated with this note at capture time -> the
     * snapshot id that was current for that record at this epoch. null means
     * the record existed but no snapshot had ever been captured for it
     * (predates history tracking, or this is the first pull of a very old
     * note).
     */
    snapshots: Record<string, string | null>;
}
/**
 * Writes a new epoch for `noteRecordName`, covering every record in
 * `recordNames` (conventionally the note's own recordName first, then any
 * table attachments - see `historyRecordNames`). For each, the most recently
 * captured snapshot id is looked up fresh: a record whose snapshot was just
 * written this run picks up its new id this way too, so the caller doesn't
 * need to track "new vs. carried over" separately - every entry is just
 * "whatever's current right now."
 */
export declare function recordEpoch(targetDir: string, noteRecordName: string, recordNames: readonly string[]): Promise<void>;
/** Every epoch recorded for `noteRecordName`, oldest first. Empty if none exist. */
export declare function listEpochs(targetDir: string, noteRecordName: string): Promise<NoteEpoch[]>;
/**
 * Finds an epoch by id under a note's own recordName - unlike
 * `findSnapshotById`, this never needs to search across a note's table
 * recordNames too, since an epoch is always filed under the note's own
 * history directory regardless of which records it covers.
 */
export declare function findEpochById(targetDir: string, noteRecordName: string, id: string): Promise<NoteEpoch | undefined>;
