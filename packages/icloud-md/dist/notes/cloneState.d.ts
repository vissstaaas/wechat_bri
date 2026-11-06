export interface CloneStateNoteEntry {
    file: string;
    recordChangeTag: string;
    modificationDate: number;
    /**
     * For a note shared *with* this account: the sharer's ownerRecordName,
     * i.e. which shared-database zone the note lives in. Absent for the
     * account's own (private-database) notes.
     */
    sharedZoneOwner?: string | undefined;
    /**
     * Set when this note contains content this tool couldn't fully parse (an
     * unresolvable embed, or unrecognized structure) - see the Safety
     * Guarantee Audit dev notes. Purely informational: `push` never trusts
     * this field, re-deriving the same check fresh from the live remote
     * record every time. Absent when the note is fully publishable.
     */
    unpublishableReason?: string | undefined;
    /**
     * The Folder record this note lives in, resolving into `folders` - the
     * note's directory derives from that folder's tree position. Absent for
     * shared notes (their Folder reference points into the sharer's zone,
     * whose folder records we can't read - see the folders doc) and in state
     * files written before folder support.
     */
    folderRecordName?: string | undefined;
    /**
     * A rename this vault owes but hasn't performed: the file *name* the note
     * should have, recorded when `pull --defer-renames` computed a rename from
     * a remote retitle and left the file where it was for someone else to move
     * (see `pendingRename.ts`). Absent whenever the name on disk is already the
     * one the note wants, which is the normal case.
     *
     * A bare name rather than a path, so it survives the note being relocated
     * into a different folder before the rename is carried out.
     */
    pendingRename?: string | undefined;
    /**
     * The `apple-note-title` value the last sync left in this note's working
     * file - the title-side counterpart of the base copy. Recorded when a
     * filename-as-title pull files a title no file name can carry (see
     * `titleFilename.ts`), so `push` can tell "the key pull wrote" from "a
     * user-edited retitle request" without fetching the live record - without
     * it, such a note read as retitled on every plan forever (and an
     * individually-shared one was refused on every `status`). Absent when the
     * last sync left no key, which is the common case; also absent in state
     * written before the field existed, where one plan-time comparison against
     * the live record backfills it.
     */
    frontmatterTitle?: string | undefined;
}
/** One synced Apple Notes folder - see the folders doc for the tree design. */
export interface CloneStateFolderEntry {
    /** Decoded folder title as of the last sync ("Recipes"). */
    name: string;
    /** Parent Folder recordName for a nested folder; absent for top-level. */
    parentRecordName?: string | undefined;
    /**
     * This folder's directory name on disk - sanitized and uniquified among
     * siblings; the full path derives from ancestors' dirNames. Persisted so
     * names stay stable across pulls (buildFolderTree's preferredDirNames).
     */
    dirName: string;
    /**
     * For a folder shared *with* this account (a whole shared folder): the
     * sharer's ownerRecordName. Its tree roots under that sharer's home
     * directory (see `sharerHomes`) instead of the vault root. Absent for the
     * account's own folders.
     */
    sharedZoneOwner?: string | undefined;
    /**
     * Shared folders only: this account's permission on the folder's share
     * ("READ_WRITE" / "READ_ONLY"), from the `cloudkit.share` record's
     * `currentUserParticipant` (nested folders inherit the shared root's).
     * Absent when unknown - e.g. state written before this field existed,
     * where an incremental pull may never re-send the share record; push then
     * attempts the write and lets the server be the authority.
     */
    permission?: string | undefined;
}
/** One sharer's top-level home directory - where everything shared by that
 * user lives: their shared folders as real subdirectories, and their
 * individually-shared notes loose at its top (those notes' folder
 * membership points into the sharer's unreadable private tree - see the
 * folders doc, 2026-07-16T21:34). */
export interface CloneStateSharerHomeEntry {
    /** Display name as of the last sync - the share's OWNER participant's
     * name, email, or phone, falling back to the opaque ownerRecordName. */
    name: string;
    /** Directory name on disk (top-level, uniquified alongside the account's
     * own root folders). */
    dirName: string;
}
export interface CloneStateAttachmentEntry {
    /** Path relative to the vault root, e.g. "attachments/_7130093.jpeg". */
    file: string;
    /** The `Media` record backing this attachment's actual bytes (distinct
     * from the `Attachment` record this entry is keyed by - see dev notes). */
    mediaRecordName: string;
    /** The Media record's `Asset.fileChecksum` as of the last download - the
     * change-detection signal `pull` compares against before re-downloading. */
    mediaFileChecksum: string;
    /** Which note this attachment belongs to, so it can be cleaned up if that
     * note is deleted or dropped from tracking. */
    noteRecordName: string;
}
export interface CloneStateTableAttachmentEntry {
    /** Which note this table attachment belongs to, so it can be cleaned up
     * if that note is deleted or dropped from tracking. */
    noteRecordName: string;
}
export interface CloneStateTrashedEntry {
    /** The vault file this note lived at before it was trashed - what
     * `delete --hard <file>` resolves against once the file itself and the
     * `notes` entry are gone. */
    file: string;
    /** ms epoch of when this tool moved the note to Recently Deleted. */
    trashedAt: number;
}
export interface CloneStateAccount {
    appleId: string;
    dsid: string;
}
/** Where a vault carries its note titles - see `CloneState.titleMode`, which
 * is the only place the value is decided. Named here rather than spelled out
 * at each use so the two shapes can't quietly grow a third. */
export type TitleMode = "in-body" | "filename";
export interface CloneState {
    /**
     * On-disk layout generation. Version 2 is the folder-tree layout (notes
     * inside folder directories, per-folder attachments). State files without
     * the field are the original flat layout, which this tool no longer
     * reads - readCloneState fails loudly telling the user to re-clone
     * (backward compatibility deliberately waived, see the folders doc,
     * 2026-07-16T21:10). writeCloneState always stamps the current version.
     *
     * Versions from 2 onward are migrated *forward* automatically rather than
     * refused - see `vaultMigrations.ts`, which is the only thing that should
     * ever change this number on an existing vault.
     */
    layoutVersion?: number | undefined;
    /**
     * Which build last wrote this state file, e.g. "icloud-md 0.4.0". Purely
     * diagnostic - it identifies the engine behind a vault in bug reports and
     * nothing branches on it. Vault *shape* is `layoutVersion`'s job alone, so
     * that there's exactly one source of truth about what's on disk.
     */
    generator?: string | undefined;
    /**
     * Where this vault carries note titles. "filename" is the Obsidian-shaped
     * mode: the file name is the title and the file holds only the body, so a
     * note doesn't show its title twice. "in-body" (the default, and the shape
     * of every vault written before the mode existed) keeps the title as the
     * note's first line.
     *
     * A property of the whole vault, never of one command: pulling a
     * filename-as-title vault in in-body mode would read as "every note
     * changed" and either duplicate or delete every title in a single run.
     * Every vault records note ids in frontmatter regardless of this, which is
     * what makes a rename resolvable at all - and a rename *is* a retitle here.
     */
    titleMode?: TitleMode | undefined;
    /**
     * Which Apple ID this folder was cloned for - resolves to that account's
     * own session under `~/.config/icloud-md/accounts/<dsid>/` (see
     * `accountStore.ts`), never anything secret stored here. Absent only for
     * folders cloned before per-folder account binding existed; `pull`/`push`/
     * `reauthenticate` refuse to run without it (see `UnboundAccountError`).
     */
    account?: CloneStateAccount | undefined;
    /** CloudKit syncToken as of this snapshot; a future `pull` resumes incremental sync from here. */
    syncToken: string | undefined;
    /**
     * Per-shared-zone syncTokens, keyed by the zone owner's recordName.
     * Absent entirely in state files written before shared-note support.
     */
    sharedZoneSyncTokens?: Record<string, string> | undefined;
    /**
     * This vault's identity in the Notes CRDT (base64 of 16 random bytes) -
     * text pushed from here is recorded in each note's replica table under
     * this id. Generated by the first `push` and stable per vault afterwards,
     * so repeated pushes read as one continuous editor rather than a parade
     * of one-shot replicas.
     */
    replicaId?: string | undefined;
    notes: Record<string, CloneStateNoteEntry>;
    /**
     * The account's folder tree as of the last sync, keyed by the Folder
     * record's recordName (including `DefaultFolder-CloudKit`; never Trash).
     * Shared folders appear here too, tagged with their `sharedZoneOwner`.
     */
    folders?: Record<string, CloneStateFolderEntry> | undefined;
    /** Per-sharer home directories, keyed by the sharer's ownerRecordName. */
    sharerHomes?: Record<string, CloneStateSharerHomeEntry> | undefined;
    /** Downloaded attachments, keyed by the `Attachment` record's recordName
     * (the identifier embedded in the owning note's body). Absent entirely in
     * state files written before Phase 4. */
    attachments?: Record<string, CloneStateAttachmentEntry> | undefined;
    /** Table attachments currently referenced by a note, keyed by the
     * `Attachment` record's recordName - same identifier space as
     * `attachments`, but tracked separately since a table has no downloaded
     * file (its content is rendered inline as markdown) and so none of
     * `CloneStateAttachmentEntry`'s file/checksum fields apply. Exists so a
     * note's table recordNames are known outside of a single pull's in-memory
     * scope (version history lookups, staleness cleanup). Absent entirely in
     * state files written before this tracking existed. */
    tableAttachments?: Record<string, CloneStateTableAttachmentEntry> | undefined;
    /**
     * Notes this tool moved to Recently Deleted (via `delete` or `push`),
     * keyed by recordName. Kept so a soft-deleted note stays reachable for
     * `delete --hard <file>` after its file and `notes` entry are gone - see
     * the "trash registry" design in the project notes (2026-07-16T11:10).
     * Entries prune when a hard delete completes or a later `pull` sees the
     * record's real server-side deletion tombstone. Absent entirely in state
     * files written before the trash registry existed.
     */
    trashed?: Record<string, CloneStateTrashedEntry> | undefined;
}
export declare const STATE_DIR_NAME = ".icloud-md";
export declare const STATE_FILE_NAME = "state.json";
/**
 * The on-disk layout generation this build reads and writes - see
 * CloneState.layoutVersion.
 *
 * Version 3 records `titleMode` explicitly and stamps every note file with
 * its `apple-note-id`, so no code has to reason about either being absent. Bumping is a one-way door - an older icloud-md meeting a
 * migrated vault refuses it - so it is spent only when the on-disk shape
 * genuinely changes, never on additive metadata.
 */
export declare const CURRENT_LAYOUT_VERSION = 3;
export declare function writeCloneState(targetDir: string, state: CloneState): Promise<void>;
/** A state file as it sits on disk, before any version-specific validation -
 * what a migration reads and rewrites. */
export type RawStateFile = Record<string, unknown>;
/**
 * The state file as raw JSON, with no validation and no version check - the
 * one way to read a vault whose shape this build doesn't understand yet.
 * Exists for `vaultMigrations.ts`, which by definition runs before the
 * validated reader can be trusted; everything else wants `readCloneState`.
 */
export declare function readRawStateFile(targetDir: string): Promise<RawStateFile | undefined>;
/** Writes a state file verbatim, stamping no version of its own - a migration
 * owns which `layoutVersion` it is committing. `writeCloneState` is the
 * normal path for everything that isn't a migration. */
export declare function writeRawStateFile(targetDir: string, state: RawStateFile | CloneState): Promise<void>;
export declare function readCloneState(targetDir: string): Promise<CloneState | undefined>;
