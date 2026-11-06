import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchAssetBytes, lookupRecords, } from "../cloudkit/databaseClient.js";
import { isEnoent } from "../fsUtil.js";
import { decodeTableMarkdown } from "./decodeTableRecord.js";
import { uniqueFileName } from "./filename.js";
import { decodeAttachmentFilename, formatAttachmentMarkdown, isTableUti, parseAssetField, renderPlaceholders, } from "./noteAttachments.js";
import { formatEmbedMarker } from "./unknownContent.js";
const ATTACHMENTS_DIR = "attachments";
/**
 * Given a note's attachment references and the already-fetched `Attachment`
 * records they name, returns each one's `Media` recordName - the next hop
 * to look up - in the same order as `refs`. An entry is `undefined` where a
 * reference doesn't resolve to a real `Attachment` record with a `Media`
 * reference; per the Safety Guarantee Audit, that degrades just that one
 * embed (an unknown-content marker) rather than refusing the whole note.
 */
export function extractMediaRecordNames(refs, attachmentRecords) {
    const attachmentByName = new Map(attachmentRecords.map((record) => [record.recordName, record]));
    return refs.map((ref) => {
        const attachmentRecord = attachmentByName.get(ref.attachmentIdentifier);
        if (!attachmentRecord || attachmentRecord.recordType !== "Attachment") {
            return undefined;
        }
        const mediaRef = attachmentRecord.fields.Media?.value;
        return isRecordRef(mediaRef) ? mediaRef.recordName : undefined;
    });
}
/**
 * Matches each attachment reference to its `Media` record (already fetched,
 * one per ref, same order as `mediaRecordNames` from
 * `extractMediaRecordNames`) and decides a local file name and whether it
 * needs (re)downloading. An entry is `undefined` where the `Media` record is
 * missing, isn't actually a `Media` record, or lacks a well-formed `Asset`
 * field; per the Safety Guarantee Audit, that degrades just that one embed
 * rather than refusing the whole note.
 */
export function matchAttachmentRecords(refs, mediaRecordNames, mediaRecords, noteRecordName, existingAttachments, usedAttachmentFileNames, noteDir) {
    const mediaByName = new Map(mediaRecords.map((record) => [record.recordName, record]));
    const matched = [];
    for (let i = 0; i < refs.length; i += 1) {
        const ref = refs[i];
        const mediaRecordName = mediaRecordNames[i];
        if (!ref || !mediaRecordName) {
            matched.push(undefined);
            continue;
        }
        const mediaRecord = mediaByName.get(mediaRecordName);
        if (!mediaRecord || mediaRecord.recordType !== "Media") {
            matched.push(undefined);
            continue;
        }
        const asset = parseAssetField(mediaRecord.fields.Asset);
        if (!asset) {
            matched.push(undefined);
            continue;
        }
        const existing = existingAttachments[ref.attachmentIdentifier];
        const fileName = existing
            ? path.basename(existing.file)
            : uniqueFileName(decodeAttachmentFilename(mediaRecord.fields.FilenameEncrypted, ref.attachmentIdentifier, ref.typeUti), usedAttachmentFileNames);
        usedAttachmentFileNames.add(fileName);
        // An already-tracked attachment stays at its existing path (its note
        // hasn't moved - the caller derives noteDir from the note's own state
        // entry); a new one lands in the attachments dir next to its note.
        const relativeFile = existing ? existing.file : path.posix.join(noteDir, ATTACHMENTS_DIR, fileName);
        matched.push({
            recordName: ref.attachmentIdentifier,
            relativeFile,
            linkPath: path.posix.relative(noteDir, relativeFile),
            needsDownload: !existing || existing.mediaFileChecksum !== asset.fileChecksum,
            downloadURL: asset.downloadURL,
            entry: { file: relativeFile, mediaRecordName, mediaFileChecksum: asset.fileChecksum, noteRecordName },
        });
    }
    return matched;
}
/**
 * Resolves every embedded reference a note contains - downloading file
 * attachments into `attachments/` and rendering a table's structure as a
 * markdown table inline - and rewrites the note's placeholders accordingly.
 *
 * A `com.apple.notes.table` reference is an `Attachment` record like any
 * other, but its payload lives directly on that record's own
 * `MergeableDataEncrypted` field rather than chaining through `Media` -
 * see `decodeTableRecord.ts` and dev notes, 2026-07-14T10:10/14:46.
 *
 * Per the Safety Guarantee Audit, a reference that doesn't match what we've
 * verified live - a file reference whose `Attachment`/`Media`/`Asset` chain
 * doesn't resolve, a table whose `MergeableDataEncrypted` doesn't decode, or
 * a placeholder with no usable `attachmentInfo` at all (an `unknown` slot) -
 * doesn't refuse the whole note. That one placeholder gets an inline embed
 * marker (see `formatEmbedMarker`) carrying whatever identity it has, and
 * the rest of the note still comes through. Since Step 1 of the formatting
 * plan (2026-07-17) a marker no longer makes the note unpublishable either -
 * `push` verifies markers survive verbatim instead. The actual matching
 * (`extractMediaRecordNames`/`matchAttachmentRecords`, `decodeTableMarkdown`)
 * is pure and unit-tested against real captures; this function is the thin
 * network+fs wrapper around it, verified live instead.
 */
export async function resolveNoteAttachments(auth, database, zoneID, targetDir, noteRecordName, bodyText, slots, existingAttachments, existingTableAttachments, usedAttachmentFileNames, noteDir) {
    const previousForNote = Object.keys(existingAttachments).filter((recordName) => existingAttachments[recordName]?.noteRecordName === noteRecordName);
    const previousTableForNote = Object.keys(existingTableAttachments).filter((recordName) => existingTableAttachments[recordName]?.noteRecordName === noteRecordName);
    if (slots.length === 0) {
        return {
            bodyText,
            attachments: {},
            staleAttachmentRecordNames: previousForNote,
            tableAttachments: {},
            staleTableAttachmentRecordNames: previousTableForNote,
            tableAttachmentSnapshots: [],
        };
    }
    const identifiedRefs = slots.flatMap((slot) => (slot.kind === "attachment" ? [slot.ref] : []));
    const attachmentRecords = identifiedRefs.length === 0
        ? []
        : await lookupRecords(auth.session, auth.ckdatabasewsUrl, auth.dsid, database, zoneID, identifiedRefs.map((ref) => ref.attachmentIdentifier));
    const attachmentByName = new Map(attachmentRecords.map((record) => [record.recordName, record]));
    // One entry per slot, same document order as the U+FFFC placeholders;
    // filled in below as each slot (unknown, table, or file) resolves.
    const replacements = new Array(slots.length).fill(undefined);
    const fileRefs = [];
    const fileRefIndexes = [];
    const tableAttachments = {};
    const tableAttachmentSnapshots = [];
    for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        if (!slot) {
            continue;
        }
        if (slot.kind === "unknown") {
            replacements[i] = formatEmbedMarker({ typeUti: slot.typeUti });
            continue;
        }
        const ref = slot.ref;
        if (isTableUti(ref.typeUti)) {
            const attachmentRecord = attachmentByName.get(ref.attachmentIdentifier);
            const markdown = decodeTableAttachment(attachmentRecord);
            if (markdown === undefined) {
                replacements[i] = formatEmbedMarker(ref);
            }
            else {
                replacements[i] = markdown;
                tableAttachments[ref.attachmentIdentifier] = { noteRecordName };
                const rawValue = attachmentRecord?.fields.MergeableDataEncrypted?.value;
                if (typeof rawValue === "string") {
                    tableAttachmentSnapshots.push({
                        recordName: ref.attachmentIdentifier,
                        noteRecordName,
                        recordChangeTag: attachmentRecord?.recordChangeTag ?? "",
                        valueBase64: rawValue,
                    });
                }
            }
        }
        else {
            fileRefIndexes.push(i);
            fileRefs.push(ref);
        }
    }
    const attachments = {};
    if (fileRefs.length > 0) {
        const mediaRecordNames = extractMediaRecordNames(fileRefs, attachmentRecords);
        const knownMediaRecordNames = mediaRecordNames.filter((name) => name !== undefined);
        const mediaRecords = await lookupRecords(auth.session, auth.ckdatabasewsUrl, auth.dsid, database, zoneID, knownMediaRecordNames);
        const matched = matchAttachmentRecords(fileRefs, mediaRecordNames, mediaRecords, noteRecordName, existingAttachments, usedAttachmentFileNames, noteDir);
        for (let j = 0; j < fileRefs.length; j += 1) {
            const attachment = matched[j];
            const ref = fileRefs[j];
            const index = fileRefIndexes[j];
            if (!ref || index === undefined) {
                continue;
            }
            if (!attachment) {
                replacements[index] = formatEmbedMarker(ref);
                continue;
            }
            if (attachment.needsDownload) {
                const bytes = await fetchAssetBytes(attachment.downloadURL);
                await mkdir(path.dirname(path.join(targetDir, attachment.relativeFile)), { recursive: true });
                await writeFile(path.join(targetDir, attachment.relativeFile), bytes);
            }
            attachments[attachment.recordName] = attachment.entry;
            replacements[index] = formatAttachmentMarkdown(ref, attachment.linkPath);
        }
    }
    const staleAttachmentRecordNames = previousForNote.filter((recordName) => !(recordName in attachments));
    const staleTableAttachmentRecordNames = previousTableForNote.filter((recordName) => !(recordName in tableAttachments));
    return {
        bodyText: renderPlaceholders(bodyText, replacements),
        attachments,
        staleAttachmentRecordNames,
        tableAttachments,
        staleTableAttachmentRecordNames,
        tableAttachmentSnapshots,
    };
}
/** Decodes a table reference's `MergeableDataEncrypted` payload into
 * markdown, or `undefined` if the record doesn't match what's been
 * verified live (missing/malformed, or a table shape this decoder refuses -
 * e.g. right-to-left column direction). The caller (`resolveNoteAttachments`)
 * turns `undefined` into an inline unknown-content marker for just this one
 * reference rather than guessing at its structure. */
export function decodeTableAttachment(attachmentRecord) {
    if (!attachmentRecord || attachmentRecord.recordType !== "Attachment") {
        return undefined;
    }
    const mergeableField = attachmentRecord.fields.MergeableDataEncrypted;
    if (!mergeableField || typeof mergeableField.value !== "string") {
        return undefined;
    }
    try {
        return decodeTableMarkdown(Buffer.from(mergeableField.value, "base64"));
    }
    catch {
        return undefined;
    }
}
/** Deletes every attachment file tracked for a note (it was deleted, or
 * dropped from tracking entirely) and returns the recordNames removed, so
 * the caller can drop them from `state.attachments`. */
export async function removeAttachmentsForNote(targetDir, noteRecordName, attachments) {
    const removed = [];
    for (const [recordName, entry] of Object.entries(attachments)) {
        if (entry.noteRecordName !== noteRecordName) {
            continue;
        }
        await safeUnlink(path.join(targetDir, entry.file));
        removed.push(recordName);
    }
    return removed;
}
/** Drops table-attachment tracking entries for a note - no file to delete (a
 * table has no downloaded file, just its rendered markdown inline), so this
 * is pure bookkeeping. Returns the recordNames removed, so the caller can
 * drop them from `state.tableAttachments`. */
export function removeTableAttachmentsForNote(noteRecordName, tableAttachments) {
    return Object.entries(tableAttachments)
        .filter(([, entry]) => entry.noteRecordName === noteRecordName)
        .map(([recordName]) => recordName);
}
async function safeUnlink(filePath) {
    try {
        await rm(filePath);
    }
    catch (cause) {
        if (!isEnoent(cause)) {
            throw cause;
        }
    }
}
function isRecordRef(value) {
    return typeof value === "object" && value !== null && typeof value.recordName === "string";
}
//# sourceMappingURL=attachmentSync.js.map