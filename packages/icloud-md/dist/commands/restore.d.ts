export interface RestoreResult {
    file: string;
}
/**
 * Discards a tracked note's local edits, overwriting it with its base copy -
 * the last-known-synced text `push`/`pull` treat as "clean". Purely local,
 * no network call. The general escape hatch for any refusal that otherwise
 * leaves a note stuck with no way back to a clean state short of hand-editing
 * the file: an attachment-bearing note `push` will never accept, unresolved
 * conflict markers the user wants to abandon rather than resolve, etc.
 *
 * Base copies are body-only (that's exactly what `localFileState` compares
 * against), so the file's local-only frontmatter has to be carried across by
 * hand here - it lives nowhere else, was never pushed, and no `pull` would
 * bring it back. `pull` and `push` already do the same around their own
 * working-file writes; this was the one write path that didn't.
 */
export declare function runRestore(targetDir: string, fileArg: string): Promise<RestoreResult>;
