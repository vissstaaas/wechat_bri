/** True if `err` is a Node "file not found" error - used by every read path
 * in this project that treats a missing file as "nothing recorded yet"
 * rather than a failure. */
export declare function isEnoent(err: unknown): boolean;
