import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isEnoent } from "../fsUtil.js";
import { STATE_DIR_NAME } from "./cloneState.js";
export const BUG_REPORT_ALIASES_FILE_NAME = "bug-report-aliases.json";
const ALIAS_PREFIXES = {
    notes: "note",
    folders: "folder",
    sharerHomes: "sharer",
    attachments: "attachment",
    trashed: "trashed",
    account: "account",
};
export function emptyAliasStore() {
    return { notes: {}, folders: {}, sharerHomes: {}, attachments: {}, trashed: {}, account: {} };
}
function aliasFilePath(targetDir) {
    return path.join(targetDir, STATE_DIR_NAME, BUG_REPORT_ALIASES_FILE_NAME);
}
/** Reads the alias store, defaulting to empty if it's never been written or
 * doesn't parse - a bug-report run shouldn't fail over its own redaction
 * bookkeeping, it should just start fresh. */
export async function readAliasStore(targetDir) {
    let raw;
    try {
        raw = await readFile(aliasFilePath(targetDir), "utf-8");
    }
    catch (cause) {
        if (isEnoent(cause)) {
            return emptyAliasStore();
        }
        throw cause;
    }
    try {
        const parsed = JSON.parse(raw);
        return normalizeAliasStore(parsed);
    }
    catch {
        return emptyAliasStore();
    }
}
function normalizeAliasStore(value) {
    const empty = emptyAliasStore();
    if (typeof value !== "object" || value === null) {
        return empty;
    }
    const record = value;
    for (const category of Object.keys(empty)) {
        const section = record[category];
        if (typeof section === "object" && section !== null) {
            for (const [key, alias] of Object.entries(section)) {
                if (typeof alias === "string") {
                    empty[category][key] = alias;
                }
            }
        }
    }
    return empty;
}
export async function writeAliasStore(targetDir, store) {
    const filePath = aliasFilePath(targetDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(store, null, 2) + "\n", "utf-8");
}
/** Returns this key's existing alias, or mints and records the next one in
 * that category (`note-1`, `note-2`, ...). Mutates `store` in place. */
export function resolveAlias(store, category, key) {
    const existing = store[category][key];
    if (existing !== undefined) {
        return existing;
    }
    const nextIndex = Object.keys(store[category]).length + 1;
    const alias = `${ALIAS_PREFIXES[category]}-${nextIndex}`;
    store[category][key] = alias;
    return alias;
}
//# sourceMappingURL=bugReportAliases.js.map