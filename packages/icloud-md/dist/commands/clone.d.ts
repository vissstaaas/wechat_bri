import type { SyncNotice, SyncProgress } from "../progress.js";
export interface CloneOptions {
    /**
     * Carry note titles in file names rather than as each note's first line -
     * the Obsidian-shaped layout, where the file name is the document title.
     * Every vault records note ids in frontmatter, which is what makes a
     * rename resolvable at all - and a rename *is* a retitle in this mode.
     */
    filenameAsTitle?: boolean;
    /**
     * Bind to an account already signed in on this machine (Apple ID or dsid)
     * instead of opening an interactive sign-in to discover which one to use.
     * Reuses that account's own trusted profile, so it normally completes with
     * no interaction at all - the difference from the default path is that the
     * caller has *named* the identity, so there is nothing ambiguous to resolve.
     */
    account?: string | undefined;
    /**
     * Never open a sign-in window: fail instead. For unattended callers (CI,
     * cron, the live integration suite), where a window has nobody to complete
     * it and so turns a fast failure into a long block. Only affects the
     * *visible* fallback - a saved session or a headless profile relaunch is
     * still tried, and is what makes an unattended `--account` clone work.
     */
    nonInteractive?: boolean;
}
export interface CloneSummary {
    written: number;
    writtenShared: number;
    writtenUnpublishable: number;
    attachmentsDownloaded: number;
    skippedDeleted: number;
    skippedUndecodable: number;
    notices: SyncNotice[];
}
/**
 * `clone` only ever performs the *initial* export into a directory - mirrors
 * `git clone`'s own refusal to run against a non-empty destination. Re-running
 * it against an already-bound folder isn't a safe "resync" as this function
 * is written: it always does a full fresh fetch with no diffing against
 * local edits and never cleans up files for notes deleted upstream, unlike
 * `pull`. Use `pull` for an existing clone instead.
 */
export declare function runClone(targetDir: string, progress?: SyncProgress, onLoginStatus?: (message: string) => void, options?: CloneOptions): Promise<CloneSummary>;
