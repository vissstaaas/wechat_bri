import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isEnoent } from "../fsUtil.js";
/**
 * A raw, byte-level capture of a note's or table attachment's own encrypted
 * field, taken every time `pull`/`push` observes a change - see the
 * "Version history" investigation. One-to-many (a record accumulates many
 * snapshots over time), unlike `baseCopy.ts`'s single pristine copy per
 * record.
 */
const HISTORY_DIR_SEGMENTS = [".icloud-md", "history"];
/**
 * Append-only capture of `input`, unless its `valueBase64` is identical to
 * the single most-recent existing snapshot for that `recordName` - in which
 * case this is a no-op. Comparing only against the immediately preceding
 * snapshot (not the full history) means a real revert-and-forward transition
 * (A -> B -> A) still records both edges; only exact, consecutive repeats -
 * e.g. from a no-op pull/push - get skipped.
 *
 * Returns whether a new snapshot was actually written - `pull`/`push` use
 * this to decide whether anything changed for a note this run at all, and so
 * whether a coordinated epoch is worth recording (see `noteEpoch.ts`).
 */
export async function recordVersion(targetDir, input) {
    const existing = await listVersions(targetDir, input.recordName);
    const last = existing[existing.length - 1];
    if (last && last.valueBase64 === input.valueBase64) {
        return false;
    }
    const capturedAt = new Date();
    const id = randomUUID();
    const snapshot = { ...input, id, timestamp: capturedAt.toISOString() };
    const dir = recordHistoryDir(targetDir, input.recordName);
    await mkdir(dir, { recursive: true });
    const shortId = id.replace(/-/g, "").slice(0, 8);
    // `existing.length` (from the listVersions call above) is a monotonic
    // append-order counter, zero-padded so it sorts correctly alongside
    // millis. Needed because two captures for the same record can land in the
    // same millisecond (e.g. a note plus its table attachment on one pull) -
    // without it, filename order (and so which snapshot dedup compares
    // against as "last") would depend on the random shortId suffix instead of
    // real append order.
    const seq = String(existing.length).padStart(6, "0");
    const fileName = `${capturedAt.getTime()}-${seq}-${shortId}.json`;
    await writeFile(path.join(dir, fileName), JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
    return true;
}
/** Every snapshot recorded for `recordName`, oldest first (filenames sort
 * naturally by capture time). Empty if none exist. */
export async function listVersions(targetDir, recordName) {
    const dir = recordHistoryDir(targetDir, recordName);
    let fileNames;
    try {
        fileNames = await readdir(dir);
    }
    catch (cause) {
        if (isEnoent(cause)) {
            return [];
        }
        throw cause;
    }
    const snapshots = [];
    for (const fileName of fileNames.filter((name) => name.endsWith(".json")).sort()) {
        const raw = await readFile(path.join(dir, fileName), "utf-8");
        snapshots.push(JSON.parse(raw));
    }
    return snapshots;
}
function recordHistoryDir(targetDir, recordName) {
    return path.join(targetDir, ...HISTORY_DIR_SEGMENTS, recordName);
}
//# sourceMappingURL=versionHistory.js.map