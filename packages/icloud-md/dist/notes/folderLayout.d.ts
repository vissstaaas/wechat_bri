import type { CloudKitRecord } from "../cloudkit/databaseClient.js";
import type { CloneState, CloneStateFolderEntry, CloneStateNoteEntry, CloneStateSharerHomeEntry } from "./cloneState.js";
/** One shared zone's raw records, tagged with its owner - the shape both
 * clone and pull already have in hand when building the layout. */
export interface SharedZoneRecords {
    ownerRecordName: string;
    records: readonly CloudKitRecord[];
}
/**
 * The vault's complete directory layout for one sync run: every folder's
 * (and sharer home's) vault-root-relative directory path, plus the state
 * maps that persist the name assignments for the next run.
 */
export interface VaultLayout {
    /** Folder recordName → vault-root-relative dirPath (own and shared). */
    folderDirs: Map<string, string>;
    /** Sharer ownerRecordName → the sharer's top-level home dirPath. */
    sharerHomeDirs: Map<string, string>;
    stateFolders: Record<string, CloneStateFolderEntry>;
    stateSharerHomes: Record<string, CloneStateSharerHomeEntry>;
    /** Every directory the layout implies, for materialization (mkdir -p). */
    allDirs: string[];
}
/**
 * Builds the layout from this run's records, carried previous state (so an
 * incremental pull still knows folders the server didn't re-send, and
 * directory names stay stable), and the sharers' zones.
 *
 * Own folders root at the vault top level; each shared zone's folders form
 * their own tree rooted under that sharer's home directory. Sharer homes
 * share the top-level namespace with the account's own root folders.
 */
export declare function buildVaultLayout(privateRecords: readonly CloudKitRecord[], sharedZones: readonly SharedZoneRecords[], previous?: Pick<CloneState, "folders" | "sharerHomes">): VaultLayout;
/** Where a note's file lives. `folderRecordName` is set only when the
 * note's Folder reference resolves to a folder this vault mirrors - an own
 * folder, or a shared folder in the note's own zone. An individually-shared
 * note's reference points into the sharer's unreadable private tree, so it
 * lands loose in the sharer's home with no folder membership. */
export interface NotePlacement {
    dir: string;
    folderRecordName?: string | undefined;
}
export declare function placeNote(layout: VaultLayout, record: CloudKitRecord, sharedZoneOwner: string | undefined): NotePlacement;
/** The vault-root-relative directory a tracked note actually sits in today,
 * from its state entry - where its attachments belong. POSIX form; "" for
 * the vault root. */
export declare function noteDirOf(stateFile: string): string;
/**
 * Where a *tracked* note should sit under the current layout, from its
 * state entry - `placeNote`'s twin for notes the server didn't re-send this
 * run. Returns undefined for "leave it where it is" (a shared note whose
 * zone has no home this run - vanished zones are handled separately).
 */
export declare function expectedNoteDir(layout: VaultLayout, entry: Pick<CloneStateNoteEntry, "folderRecordName" | "sharedZoneOwner">): string | undefined;
/** What a directory path in the vault corresponds to, per the state maps. */
export interface StateDirInfo {
    kind: "folder" | "sharerHome";
    /** Set for kind "folder". */
    folderRecordName?: string | undefined;
    /** Set for a shared folder or a sharer home. */
    sharedZoneOwner?: string | undefined;
    /** Shared folders only: this account's permission on the folder's share,
     * when known - see CloneStateFolderEntry.permission. */
    permission?: string | undefined;
}
/**
 * Reconstructs the directory map the carried state implies (dirPath →
 * what's there), without needing this run's records - the index `push`/
 * `status` classify local directories against, and the source of the
 * previous layout's paths for pull's stale-directory sweep. Best-effort:
 * unknown parents resolve the way buildFolderTree promoted them (to the
 * root of their namespace).
 */
export declare function stateDirIndex(previous: Pick<CloneState, "folders" | "sharerHomes">): Map<string, StateDirInfo>;
/** Every directory path the previous layout implied - see stateDirIndex. */
export declare function previousLayoutDirs(previous: Pick<CloneState, "folders" | "sharerHomes">): string[];
/** The sharer's display name, from the OWNER participant of any share
 * record in the zone: full name, else email, else phone. */
export declare function sharerDisplayName(zone: SharedZoneRecords): string | undefined;
