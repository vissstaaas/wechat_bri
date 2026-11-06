import type { CloudKitRecord } from "../cloudkit/databaseClient.js";
export declare function modificationDateOf(record: CloudKitRecord): number;
export declare function creationDateOf(record: CloudKitRecord): number;
/**
 * Sets the on-disk mtime/atime to match the note's iCloud timestamps, so
 * `ls -lt` / `ls -latr` ordering matches what the Notes app shows on the
 * phone instead of reflecting whenever `clone`/`pull` happened to run.
 */
export declare function applyNoteFileTimes(filePath: string, record: CloudKitRecord): Promise<void>;
