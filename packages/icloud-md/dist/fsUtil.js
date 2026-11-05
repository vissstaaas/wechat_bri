/** True if `err` is a Node "file not found" error - used by every read path
 * in this project that treats a missing file as "nothing recorded yet"
 * rather than a failure. */
export function isEnoent(err) {
    return err instanceof Error && "code" in err && err.code === "ENOENT";
}
//# sourceMappingURL=fsUtil.js.map