import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CorruptStateFileError, UnsupportedVaultLayoutError } from "../errors.js";
import { isEnoent } from "../fsUtil.js";
import { readOwnPackageVersion } from "../version.js";
export const STATE_DIR_NAME = ".icloud-md";
export const STATE_FILE_NAME = "state.json";
/**
 * The on-disk layout generation this build reads and writes - see
 * CloneState.layoutVersion.
 *
 * Version 3 records `titleMode` explicitly and stamps every note file with
 * its `apple-note-id`, so no code has to reason about either being absent. Bumping is a one-way door - an older icloud-md meeting a
 * migrated vault refuses it - so it is spent only when the on-disk shape
 * genuinely changes, never on additive metadata.
 */
export const CURRENT_LAYOUT_VERSION = 3;
export async function writeCloneState(targetDir, state) {
    const stamped = {
        ...state,
        layoutVersion: CURRENT_LAYOUT_VERSION,
        generator: `icloud-md ${readOwnPackageVersion()}`,
    };
    await writeRawStateFile(targetDir, stamped);
}
/**
 * The state file as raw JSON, with no validation and no version check - the
 * one way to read a vault whose shape this build doesn't understand yet.
 * Exists for `vaultMigrations.ts`, which by definition runs before the
 * validated reader can be trusted; everything else wants `readCloneState`.
 */
export async function readRawStateFile(targetDir) {
    const filePath = path.join(targetDir, STATE_DIR_NAME, STATE_FILE_NAME);
    let raw;
    try {
        raw = await readFile(filePath, "utf-8");
    }
    catch (cause) {
        if (isEnoent(cause)) {
            return undefined;
        }
        throw cause;
    }
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
        throw new CorruptStateFileError(`${filePath} does not look like a valid state file (not a JSON object).`);
    }
    return parsed;
}
/** Writes a state file verbatim, stamping no version of its own - a migration
 * owns which `layoutVersion` it is committing. `writeCloneState` is the
 * normal path for everything that isn't a migration. */
export async function writeRawStateFile(targetDir, state) {
    const dir = path.join(targetDir, STATE_DIR_NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, STATE_FILE_NAME), JSON.stringify(state, null, 2) + "\n", "utf-8");
}
export async function readCloneState(targetDir) {
    const filePath = path.join(targetDir, STATE_DIR_NAME, STATE_FILE_NAME);
    let raw;
    try {
        raw = await readFile(filePath, "utf-8");
    }
    catch (cause) {
        if (isEnoent(cause)) {
            return undefined;
        }
        throw cause;
    }
    const parsed = JSON.parse(raw);
    return assertCloneState(parsed, filePath);
}
function assertCloneState(value, filePath) {
    if (typeof value !== "object" || value === null || !isRecord(value) || !isRecord(value.notes)) {
        throw new CorruptStateFileError(`${filePath} does not look like a valid state file (missing "notes" object).`);
    }
    if (value.layoutVersion !== CURRENT_LAYOUT_VERSION) {
        throw new UnsupportedVaultLayoutError(path.dirname(path.dirname(filePath)));
    }
    const syncToken = typeof value.syncToken === "string" ? value.syncToken : undefined;
    const notes = {};
    for (const [recordName, entry] of Object.entries(value.notes)) {
        if (!isRecord(entry) ||
            typeof entry.file !== "string" ||
            typeof entry.recordChangeTag !== "string" ||
            typeof entry.modificationDate !== "number") {
            throw new CorruptStateFileError(`${filePath} has a malformed entry for note "${recordName}".`);
        }
        notes[recordName] = {
            file: entry.file,
            recordChangeTag: entry.recordChangeTag,
            modificationDate: entry.modificationDate,
            sharedZoneOwner: typeof entry.sharedZoneOwner === "string" ? entry.sharedZoneOwner : undefined,
            unpublishableReason: typeof entry.unpublishableReason === "string" ? entry.unpublishableReason : undefined,
            folderRecordName: typeof entry.folderRecordName === "string" ? entry.folderRecordName : undefined,
            pendingRename: typeof entry.pendingRename === "string" ? entry.pendingRename : undefined,
            frontmatterTitle: typeof entry.frontmatterTitle === "string" ? entry.frontmatterTitle : undefined,
        };
    }
    let folders;
    if (isRecord(value.folders)) {
        folders = {};
        for (const [recordName, entry] of Object.entries(value.folders)) {
            if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.dirName !== "string") {
                throw new CorruptStateFileError(`${filePath} has a malformed entry for folder "${recordName}".`);
            }
            folders[recordName] = {
                name: entry.name,
                parentRecordName: typeof entry.parentRecordName === "string" ? entry.parentRecordName : undefined,
                dirName: entry.dirName,
                sharedZoneOwner: typeof entry.sharedZoneOwner === "string" ? entry.sharedZoneOwner : undefined,
                permission: typeof entry.permission === "string" ? entry.permission : undefined,
            };
        }
    }
    let sharerHomes;
    if (isRecord(value.sharerHomes)) {
        sharerHomes = {};
        for (const [owner, entry] of Object.entries(value.sharerHomes)) {
            if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.dirName !== "string") {
                throw new CorruptStateFileError(`${filePath} has a malformed entry for sharer home "${owner}".`);
            }
            sharerHomes[owner] = { name: entry.name, dirName: entry.dirName };
        }
    }
    const replicaId = typeof value.replicaId === "string" ? value.replicaId : undefined;
    let sharedZoneSyncTokens;
    if (isRecord(value.sharedZoneSyncTokens)) {
        sharedZoneSyncTokens = {};
        for (const [owner, token] of Object.entries(value.sharedZoneSyncTokens)) {
            if (typeof token !== "string") {
                throw new CorruptStateFileError(`${filePath} has a malformed shared-zone syncToken for owner "${owner}".`);
            }
            sharedZoneSyncTokens[owner] = token;
        }
    }
    let attachments;
    if (isRecord(value.attachments)) {
        attachments = {};
        for (const [recordName, entry] of Object.entries(value.attachments)) {
            if (!isRecord(entry) ||
                typeof entry.file !== "string" ||
                typeof entry.mediaRecordName !== "string" ||
                typeof entry.mediaFileChecksum !== "string" ||
                typeof entry.noteRecordName !== "string") {
                throw new CorruptStateFileError(`${filePath} has a malformed entry for attachment "${recordName}".`);
            }
            attachments[recordName] = {
                file: entry.file,
                mediaRecordName: entry.mediaRecordName,
                mediaFileChecksum: entry.mediaFileChecksum,
                noteRecordName: entry.noteRecordName,
            };
        }
    }
    let tableAttachments;
    if (isRecord(value.tableAttachments)) {
        tableAttachments = {};
        for (const [recordName, entry] of Object.entries(value.tableAttachments)) {
            if (!isRecord(entry) || typeof entry.noteRecordName !== "string") {
                throw new CorruptStateFileError(`${filePath} has a malformed entry for table attachment "${recordName}".`);
            }
            tableAttachments[recordName] = { noteRecordName: entry.noteRecordName };
        }
    }
    let trashed;
    if (isRecord(value.trashed)) {
        trashed = {};
        for (const [recordName, entry] of Object.entries(value.trashed)) {
            if (!isRecord(entry) || typeof entry.file !== "string" || typeof entry.trashedAt !== "number") {
                throw new CorruptStateFileError(`${filePath} has a malformed entry for trashed note "${recordName}".`);
            }
            trashed[recordName] = { file: entry.file, trashedAt: entry.trashedAt };
        }
    }
    let account;
    if (value.account !== undefined) {
        if (!isRecord(value.account) || typeof value.account.appleId !== "string" || typeof value.account.dsid !== "string") {
            throw new CorruptStateFileError(`${filePath} has a malformed "account" field.`);
        }
        account = { appleId: value.account.appleId, dsid: value.account.dsid };
    }
    return {
        layoutVersion: CURRENT_LAYOUT_VERSION,
        generator: typeof value.generator === "string" ? value.generator : undefined,
        titleMode: value.titleMode === "filename" ? "filename" : "in-body",
        account,
        syncToken,
        sharedZoneSyncTokens,
        replicaId,
        notes,
        folders,
        sharerHomes,
        attachments,
        tableAttachments,
        trashed,
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=cloneState.js.map