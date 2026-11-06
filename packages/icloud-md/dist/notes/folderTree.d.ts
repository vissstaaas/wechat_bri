import type { CloudKitRecord } from "../cloudkit/databaseClient.js";
/** The account's default "Notes" folder - a real Folder record like any
 * other, just with a well-known name (confirmed live 2026-07-16, title
 * "Notes"). It becomes an ordinary directory in the clone. */
export declare const DEFAULT_FOLDER_RECORD_NAME = "DefaultFolder-CloudKit";
/** Directory names the clone reserves for itself at the top level. */
export declare const RESERVED_TOP_LEVEL_DIR_NAMES: readonly string[];
/** Directory names the clone reserves inside *every* folder directory:
 * attachments live per-folder (decided 2026-07-16, see the folders doc), so
 * a real Notes folder titled "attachments" uniquifies to "attachments 2/"
 * wherever it sits. */
export declare const RESERVED_SIBLING_DIR_NAMES: readonly string[];
/** A Folder record as decoded from the sync stream - the raw material for
 * buildFolderTree. */
export interface FolderInfo {
    recordName: string;
    /** Decoded title ("Notes", "Recipes", ...). Empty when the record has no
     * decodable TitleEncrypted; sanitizeFolderDirName supplies the fallback. */
    title: string;
    /**
     * The parent Folder's recordName for a nested folder; undefined for a
     * top-level one. Confirmed live 2026-07-16 (see the folders doc): a
     * nested folder carries an explicit `ParentFolder` REFERENCE field and
     * the same value in CloudKit's record-level parent; a top-level folder
     * has neither.
     */
    parentRecordName?: string | undefined;
    /**
     * The `cloudkit.share` record this folder is the shared root of, when it
     * is one (shared folders in a sharee's zone carry a record-level `share`
     * reference - confirmed live 2026-07-17, see the shared-writes doc).
     * The permission on that share gates writes into the folder.
     */
    shareRecordName?: string | undefined;
    /**
     * This account's permission on the folder's share as carried forward from
     * previous state - the fallback when this run's records don't re-send the
     * share record (see buildVaultLayout's resolution order).
     */
    permission?: string | undefined;
}
export interface FolderTreeNode extends FolderInfo {
    /** Directory name on disk: sanitized title, uniquified among siblings. */
    dirName: string;
    /** Vault-root-relative POSIX path ("Recipes/Desserts"). */
    dirPath: string;
    children: FolderTreeNode[];
}
export interface FolderTree {
    roots: FolderTreeNode[];
    byRecordName: Map<string, FolderTreeNode>;
}
/**
 * Decodes one raw CloudKit record into a FolderInfo, or undefined for
 * records that don't participate in the folder tree: non-Folder types and
 * the Trash folder (trashed notes are excluded from the clone entirely).
 */
export declare function decodeFolderRecord(record: CloudKitRecord): FolderInfo | undefined;
/** Same character rules as note file names, minus the extension; folders
 * with no usable title become "Untitled Folder". */
export declare function sanitizeFolderDirName(title: string): string;
/**
 * Builds the on-disk directory tree from decoded Folder records.
 *
 * Sibling directory names are uniquified case-insensitively (two sibling
 * folders "recipes" and "Recipes" must not collide on a case-insensitive
 * filesystem), and the reserved top-level names are pre-claimed so no root
 * folder can shadow them.
 *
 * `preferredDirNames` (folder recordName → dirName, from a previous sync's
 * state) keeps directory names stable across pulls: a folder keeps its
 * existing directory as long as that name is still available among its
 * siblings, even when a newly-appeared sibling would otherwise have claimed
 * it first. Folders with a preferred name are assigned before those
 * without.
 *
 * Defensive shape handling, since the server owns this data: a folder whose
 * parent isn't in the input, or whose ancestry cycles, is promoted to a
 * root rather than dropped - every folder always lands somewhere visible.
 */
export declare function buildFolderTree(folders: readonly FolderInfo[], preferredDirNames?: ReadonlyMap<string, string>): FolderTree;
