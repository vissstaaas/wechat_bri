/**
 * Pure logic behind `push`'s table write path - the network/fs orchestration
 * lives in `src/commands/push.ts`; everything here takes plain data in and
 * returns plain data out, so it can be unit-tested directly against the
 * real captured fixtures the way `attachmentSync.ts`'s pure helpers are.
 */
import type { CloudKitRecord } from "../cloudkit/databaseClient.js";
export type TableAttachmentUpdateResult = {
    ok: true;
    changed: boolean;
    mergeableDataBase64: string;
} | {
    ok: false;
    reason: string;
};
/**
 * Diffs one table attachment record's grid against what's wanted locally
 * and, when they differ, applies the edit through `tableEdit.ts`'s
 * incremental engine (the corrected design from the table write-engine
 * investigation, dev log 2026-07-16T16:31) under the same per-clone replica
 * identity note-body edits use. Every write is triple-gated: the incoming
 * bytes must pass the byte-for-byte round-trip gate (we refuse to edit a
 * document our model didn't capture completely), the edited document must
 * pass the structural-invariant checks and decode to exactly the desired
 * grid (`applyTableEdit` enforces both), and the re-encoded bytes must
 * round-trip too. Unsupported edit shapes (both axes changed at once,
 * reorders, ...) are refused with the engine's reason, never guessed at.
 */
export declare function prepareTableAttachmentUpdate(record: CloudKitRecord, desiredGrid: string[][], replicaId: Uint8Array): TableAttachmentUpdateResult;
