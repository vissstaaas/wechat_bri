import type { CloneState } from "./cloneState.js";
import { type VaultLayout } from "./folderLayout.js";
export interface Relocation {
    from: string;
    to: string;
}
/**
 * Moves every tracked note (and its attachments) whose on-disk directory no
 * longer matches the current layout - the tail half of pull's tree
 * reconciliation, covering remote folder renames/moves and remote
 * note-moves between folders. "Remote wins": local placement is never
 * consulted, only reported via the returned relocations.
 *
 * Mechanics per note: the file keeps its basename unless the target
 * directory already has it (Finder-style " 2" then applies); its
 * attachments move into the target's `attachments/`, and in the rare case
 * an attachment basename collides there, the note body's (and base copy's)
 * link is rewritten to match, identically in both so the note doesn't start
 * reading as locally modified. A note whose file is missing locally is left
 * alone - recreating missing files stays `pull`'s record-processing
 * concern.
 */
export declare function reconcileNotePlacements(targetDir: string, layout: VaultLayout, notes: CloneState["notes"], attachments: NonNullable<CloneState["attachments"]>): Promise<Relocation[]>;
/**
 * Best-effort removal of directories the previous layout used but the
 * current one doesn't - after a folder rename, the old directory should
 * vanish once its contents moved. Never touches a directory that still has
 * anything in it (untracked local files stay put, and stay visible).
 */
export declare function removeStaleDirs(targetDir: string, previousDirs: readonly string[], currentDirs: ReadonlySet<string>): Promise<void>;
