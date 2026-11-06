import { decodeTableMarkdown } from "./decodeTableRecord.js";
import { classifyNoteRecord } from "./decodeNoteRecord.js";
function isCloudKitRecordShaped(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.recordName === "string" &&
        typeof candidate.recordType === "string" &&
        typeof candidate.fields === "object" &&
        candidate.fields !== null);
}
/** Finds every record-shaped object anywhere in a captured response body -
 * duck-typed rather than parsed per-endpoint, since `records/lookup`,
 * `records/modify`, and `changes/zone` each nest `records` differently
 * (bare array vs. under `zones[].records`). Request bodies are never
 * logged (see DebugLogEntry) so there's nothing to walk there. */
function collectRecords(value, found) {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectRecords(item, found);
        }
        return;
    }
    if (value === null || typeof value !== "object") {
        return;
    }
    if (isCloudKitRecordShaped(value)) {
        found.push(value);
    }
    for (const fieldValue of Object.values(value)) {
        collectRecords(fieldValue, found);
    }
}
/** Best-effort per-record decode: uses the same decoders `pull`/`push` rely
 * on, both of which already refuse (return "unsyncable" / throw) rather
 * than mis-decode content they don't fully understand - caught here and
 * treated as "nothing readable to show" instead of failing the whole
 * bug-report run. */
function decodeRecord(record) {
    if (record.fields.TextDataEncrypted) {
        try {
            const decoded = classifyNoteRecord(record);
            if (decoded.status === "ok") {
                return { recordName: record.recordName, recordType: record.recordType, kind: "note", title: decoded.title, bodyText: decoded.bodyText };
            }
        }
        catch {
            // Fall through - nothing decodable for this record.
        }
        return undefined;
    }
    const tableField = record.fields.MergeableDataEncrypted;
    if (tableField && typeof tableField.value === "string") {
        try {
            const tableMarkdown = decodeTableMarkdown(Buffer.from(tableField.value, "base64"));
            return { recordName: record.recordName, recordType: record.recordType, kind: "table", tableMarkdown };
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
/** Decodes every distinct note/table content blob found across the debug
 * log slice a bug report bundles. Dedupes on (recordName, exact field
 * bytes) so the same unchanged record fetched twice (e.g. a lookup then a
 * changes/zone re-sync) only shows up once. */
export function buildContentPreview(logEntries) {
    const records = [];
    for (const entry of logEntries) {
        collectRecords(entry.response?.body, records);
    }
    const seen = new Set();
    const previews = [];
    for (const record of records) {
        const dedupeKey = `${record.recordName}:${String(record.fields.TextDataEncrypted?.value ?? "")}:${String(record.fields.MergeableDataEncrypted?.value ?? "")}`;
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        const preview = decodeRecord(record);
        if (preview) {
            previews.push(preview);
        }
    }
    return previews;
}
export function renderContentPreview(previews, generatedAt) {
    const lines = [];
    lines.push("# Decoded content preview - DO NOT ATTACH OR SHARE THIS FILE", "");
    lines.push(`Generated: ${generatedAt.toISOString()}`, "");
    lines.push("This is a local-only companion to the bug report next to it, not part of it and not meant to be posted " +
        "anywhere. It's every note/table content this tool could decode out of that report's debug-log entries, " +
        "shown in plain text so you can see exactly what you'd be exposing before you decide whether (and how) to " +
        "share the report itself. Delete this file once you've reviewed it.", "");
    if (previews.length === 0) {
        lines.push("Nothing in this report's debug-log entries decoded to readable note/table content.");
        return lines.join("\n");
    }
    for (const preview of previews) {
        lines.push(`## ${preview.recordType} ${preview.recordName}`, "");
        if (preview.kind === "note") {
            lines.push(`**Title:** ${preview.title || "(untitled)"}`, "");
            lines.push("```", preview.bodyText ?? "", "```", "");
        }
        else {
            lines.push("```", preview.tableMarkdown ?? "", "```", "");
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=bugReportContentPreview.js.map