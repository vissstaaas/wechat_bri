import { utimes } from "node:fs/promises";
export function modificationDateOf(record) {
    return dateFieldOf(record, "ModificationDate");
}
export function creationDateOf(record) {
    return dateFieldOf(record, "CreationDate");
}
function dateFieldOf(record, name) {
    const field = record.fields[name];
    return typeof field?.value === "number" ? field.value : 0;
}
/**
 * Sets the on-disk mtime/atime to match the note's iCloud timestamps, so
 * `ls -lt` / `ls -latr` ordering matches what the Notes app shows on the
 * phone instead of reflecting whenever `clone`/`pull` happened to run.
 */
export async function applyNoteFileTimes(filePath, record) {
    const modificationDate = modificationDateOf(record);
    if (modificationDate === 0) {
        return;
    }
    const creationDate = creationDateOf(record);
    const mtime = new Date(modificationDate);
    const atime = creationDate !== 0 ? new Date(creationDate) : mtime;
    await utimes(filePath, atime, mtime);
}
//# sourceMappingURL=noteTimestamps.js.map