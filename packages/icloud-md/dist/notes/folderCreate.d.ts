/**
 * Planning the Folder records a push needs to create.
 *
 * A note can only be created inside a folder the account actually has, so
 * until now a file in a directory the account didn't know about was refused
 * outright. This turns that directory into a real Notes folder instead.
 *
 * Scope, deliberately narrow (see the folder-creation dev log):
 *
 *  - Only directories that a note is actually going *into* become folders.
 *    A stray empty directory, or one holding nothing this push would sync,
 *    is left alone - creating remote folders for editor scratch dirs would
 *    be a nasty surprise.
 *  - Creation only. A locally *renamed* directory reads as a new folder plus
 *    a set of moves; the folder it left behind stays on the server, empty.
 *    Deleting a remote folder is a separate, riskier feature (there is no
 *    id on a directory to tell a rename from a delete-plus-create), and is
 *    not attempted here.
 *  - Nothing is ever created inside another user's shared area: the folder
 *    would have to live in their zone, under their share's structure.
 *
 * Record names are generated client-side, exactly as note creates do, which
 * is what lets a single push plan a folder and the notes inside it at the
 * same time: the notes can reference the folder's id before it exists.
 */
import type { StateDirInfo } from "./folderLayout.js";
/** One Folder record a push intends to create. */
export interface PlannedFolder {
    /** Client-generated record name, usable by dependent writes immediately. */
    recordName: string;
    /** The folder's title, which is simply the directory's own name. */
    title: string;
    /** Vault-root-relative directory this folder corresponds to. */
    dirPath: string;
    /** Parent Folder's record name; absent for a top-level folder. */
    parentRecordName?: string | undefined;
}
/** A directory that cannot become a folder, and why. */
export interface RefusedFolder {
    dirPath: string;
    reason: string;
}
export interface FolderCreatePlan {
    /** Parent-before-child order, so the plan can be executed as-is. */
    folders: PlannedFolder[];
    refusals: RefusedFolder[];
    /** Directory path → the folder record name it will have, planned or existing. */
    dirToRecordName: Map<string, string>;
}
export interface PlanFolderCreatesOptions {
    /** Directories notes are being created in or moved into, vault-root-relative. */
    wantedDirs: Iterable<string>;
    /** The directories the account already has, from `stateDirIndex`. */
    dirIndex: ReadonlyMap<string, StateDirInfo>;
    /** Injectable for tests; defaults to `crypto.randomUUID`. */
    newRecordName?: () => string;
}
/**
 * Works out which directories must become Folder records.
 *
 * Walks each wanted directory from the root down, so an intermediate
 * directory that doesn't exist yet is planned before the one nested inside
 * it, and two notes in sibling directories under the same new parent plan
 * that parent exactly once.
 */
export declare function planFolderCreates(options: PlanFolderCreatesOptions): FolderCreatePlan;
/** The directory a note file sits in, vault-root-relative ("" at the top). */
export declare function dirOfFile(file: string): string;
