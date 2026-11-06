import path from "node:path";
import { resolveAlias } from "./bugReportAliases.js";
/**
 * Field names that identify the account's real-world owner (name, email,
 * aliases) rather than describing sync-relevant account state. These show
 * up nested inside captured `dsInfo`-shaped response bodies (see
 * setupClient.ts) and add nothing a Notes-sync bug report needs, so they're
 * dropped outright rather than pseudonymized - unlike dsid/appleId (see
 * ACCOUNT_SCALAR_FIELD_NAMES below), nobody needs to tell us "this is the
 * same person" using their real name.
 */
const DROPPED_IDENTITY_FIELDS = new Set([
    "firstName",
    "lastName",
    "fullName",
    "primaryEmail",
    "primaryEmailVerified",
    "appleIdAlias",
    "appleIdAliases",
    "iCloudAppleIdAlias",
    "appleIdEntries",
    "aDsID",
]);
/** Field names whose string values are the account's dsid/appleId - kept
 * (via a stable per-value alias, not dropped) because these two do
 * legitimately recur across a report in ways worth correlating (e.g. "is
 * this URL and this response for the same account"). */
const ACCOUNT_SCALAR_FIELD_NAMES = new Set(["dsid", "appleId"]);
const DSID_IN_URL_PATTERN = /[?&]dsid=([^&]+)/g;
/** Finds every real dsid/appleId value that appears anywhere in the state
 * or the captured debug log, so they can all be pseudonymized consistently
 * - including a bare `dsid` query-string param, which isn't a JSON field
 * itself but a substring of a URL. */
export function discoverAccountScalars(state, logEntries) {
    const found = new Set();
    if (state?.account) {
        if (state.account.dsid)
            found.add(state.account.dsid);
        if (state.account.appleId)
            found.add(state.account.appleId);
    }
    for (const entry of logEntries) {
        if (entry.request?.url) {
            for (const match of entry.request.url.matchAll(DSID_IN_URL_PATTERN)) {
                if (match[1])
                    found.add(decodeURIComponent(match[1]));
            }
        }
        collectFieldValues(entry.response?.body, ACCOUNT_SCALAR_FIELD_NAMES, found);
    }
    return found;
}
function collectFieldValues(value, fieldNames, found) {
    if (Array.isArray(value)) {
        for (const item of value)
            collectFieldValues(item, fieldNames, found);
        return;
    }
    if (value !== null && typeof value === "object") {
        for (const [key, fieldValue] of Object.entries(value)) {
            if (fieldNames.has(key) && typeof fieldValue === "string" && fieldValue.length > 0) {
                found.add(fieldValue);
            }
            collectFieldValues(fieldValue, fieldNames, found);
        }
    }
}
function substituteScalars(text, accountAliasMap) {
    let result = text;
    for (const [real, alias] of accountAliasMap) {
        if (real) {
            result = result.split(real).join(alias);
        }
    }
    return result;
}
function redactBodyValue(value, accountAliasMap) {
    if (Array.isArray(value)) {
        return value.map((item) => redactBodyValue(item, accountAliasMap));
    }
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const [key, fieldValue] of Object.entries(value)) {
            if (DROPPED_IDENTITY_FIELDS.has(key)) {
                out[key] = "[omitted]";
                continue;
            }
            out[key] = redactBodyValue(fieldValue, accountAliasMap);
        }
        return out;
    }
    if (typeof value === "string") {
        return substituteScalars(value, accountAliasMap);
    }
    return value;
}
/** Redacts the debug log slice bug-report bundles: drops real-name/email
 * identity fields, and pseudonymizes every dsid/appleId occurrence
 * (including inside URLs) via `accountAliasMap`. Cookie/session-token
 * redaction already happened when these entries were originally logged
 * (see debugLog.ts) - this only handles what that pass doesn't. */
export function redactDebugLogEntries(entries, accountAliasMap) {
    return entries.map((entry) => ({
        ...entry,
        ...(entry.request ? { request: { ...entry.request, url: substituteScalars(entry.request.url, accountAliasMap) } } : {}),
        ...(entry.response ? { response: { ...entry.response, body: redactBodyValue(entry.response.body, accountAliasMap) } } : {}),
    }));
}
/** Rebuilds a note's path purely from the folder tree's record-name graph
 * (walking `parentRecordName` up to the root, plus the sharer home for a
 * shared note) rather than by pattern-matching the existing real path -
 * that keeps sibling folders that happen to share a display name from
 * being conflated, since we're never doing string matching on real names. */
function folderChainAliases(state, store, folderRecordName) {
    // Collect real recordNames root-to-leaf first, then mint aliases in that
    // same order - so a top-level folder reliably gets a lower `folder-N`
    // than the folders nested under it, instead of numbering depending on
    // upward-walk order.
    const recordNames = [];
    const seen = new Set();
    let current = folderRecordName;
    while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        recordNames.unshift(current);
        current = state.folders?.[current]?.parentRecordName;
    }
    return recordNames.map((recordName) => resolveAlias(store, "folders", recordName));
}
function redactedNotePath(state, store, recordName, entry) {
    const ext = path.posix.extname(entry.file) || ".md";
    const segments = [];
    if (entry.sharedZoneOwner) {
        segments.push(resolveAlias(store, "sharerHomes", entry.sharedZoneOwner));
    }
    segments.push(...folderChainAliases(state, store, entry.folderRecordName));
    segments.push(`${resolveAlias(store, "notes", recordName)}${ext}`);
    return segments.join("/");
}
function redactedAttachmentPath(state, store, recordName, entry) {
    const owningNote = state.notes[entry.noteRecordName];
    const noteDir = owningNote ? path.posix.dirname(redactedNotePath(state, store, entry.noteRecordName, owningNote)) : "";
    const ext = path.posix.extname(entry.file);
    const leaf = `${resolveAlias(store, "attachments", recordName)}${ext}`;
    return noteDir && noteDir !== "." ? `${noteDir}/attachments/${leaf}` : `attachments/${leaf}`;
}
function redactedTrashedPath(store, recordName, entry) {
    // Trashed entries carry no folderRecordName (see CloneStateTrashedEntry),
    // so there's no record-graph path to rebuild - alias the whole thing
    // flat rather than risk conflating unrelated folders by name-matching.
    const ext = path.posix.extname(entry.file) || ".md";
    return `${resolveAlias(store, "trashed", recordName)}${ext}`;
}
/**
 * Replaces every note/folder/sharer/attachment/trashed real name and the
 * account's dsid/appleId with stable aliases from `store` (minting new ones
 * as needed - callers persist `store` afterward). recordNames, change tags,
 * checksums, and timestamps are left untouched: they're already opaque and
 * are exactly the detail a bug report needs to be useful.
 */
export function redactCloneState(state, store) {
    const fileReplacements = new Map();
    const notes = {};
    for (const [recordName, entry] of Object.entries(state.notes)) {
        const aliasedPath = redactedNotePath(state, store, recordName, entry);
        fileReplacements.set(entry.file, aliasedPath);
        notes[recordName] = { ...entry, file: aliasedPath };
    }
    let folders;
    if (state.folders) {
        folders = {};
        for (const [recordName, entry] of Object.entries(state.folders)) {
            const alias = resolveAlias(store, "folders", recordName);
            folders[recordName] = { ...entry, name: alias, dirName: alias };
        }
    }
    let sharerHomes;
    if (state.sharerHomes) {
        sharerHomes = {};
        for (const [owner, entry] of Object.entries(state.sharerHomes)) {
            const alias = resolveAlias(store, "sharerHomes", owner);
            sharerHomes[owner] = { ...entry, name: alias, dirName: alias };
        }
    }
    let attachments;
    if (state.attachments) {
        attachments = {};
        for (const [recordName, entry] of Object.entries(state.attachments)) {
            const aliasedPath = redactedAttachmentPath(state, store, recordName, entry);
            fileReplacements.set(entry.file, aliasedPath);
            attachments[recordName] = { ...entry, file: aliasedPath };
        }
    }
    let trashed;
    if (state.trashed) {
        trashed = {};
        for (const [recordName, entry] of Object.entries(state.trashed)) {
            const aliasedPath = redactedTrashedPath(store, recordName, entry);
            fileReplacements.set(entry.file, aliasedPath);
            trashed[recordName] = { ...entry, file: aliasedPath };
        }
    }
    const account = state.account
        ? {
            appleId: resolveAlias(store, "account", state.account.appleId),
            dsid: resolveAlias(store, "account", state.account.dsid),
        }
        : undefined;
    return { state: { ...state, account, notes, folders, sharerHomes, attachments, trashed }, fileReplacements };
}
/** Builds the ordered (longest-first, so a full path is substituted before
 * its own basename could partially match something else) list of
 * real-to-alias text replacements for scrubbing `lastError`'s free-text
 * message/hint - which can legitimately quote a real file path or Apple ID
 * (e.g. AccountMismatchError, AmbiguousTrackedFileError). A real filename
 * the user typed but that was never actually tracked (a brand new local
 * file, or a typo) can't be caught this way - there's no record of it to
 * alias against - which is a known, documented gap. */
export function buildTextReplacements(fileReplacements, accountAliasMap) {
    const basenameReplacements = new Map();
    for (const [real, alias] of fileReplacements) {
        const realBase = path.posix.basename(real);
        if (!basenameReplacements.has(realBase)) {
            basenameReplacements.set(realBase, path.posix.basename(alias));
        }
    }
    const all = new Map([...fileReplacements, ...basenameReplacements, ...accountAliasMap]);
    return [...all.entries()].sort(([a], [b]) => b.length - a.length);
}
export function redactLastError(lastError, replacements) {
    if (!lastError) {
        return undefined;
    }
    return {
        ...lastError,
        message: applyReplacements(lastError.message, replacements),
        ...(lastError.hint !== undefined ? { hint: applyReplacements(lastError.hint, replacements) } : {}),
    };
}
function applyReplacements(text, replacements) {
    let result = text;
    for (const [real, alias] of replacements) {
        if (real) {
            result = result.split(real).join(alias);
        }
    }
    return result;
}
//# sourceMappingURL=bugReportRedaction.js.map