/**
 * Every Apple ID this machine has ever signed into gets its own subdirectory
 * here - `session.local.json`, a persistent Playwright `browser-profile/`
 * (for device-trust reuse), and `meta.json` (`{ appleId, dsid }`). A cloned
 * folder never holds any of this itself; it only records which account's
 * subdirectory to use (see `CloneState.account` in `cloneState.ts`) - so
 * copying/zipping/syncing a vault elsewhere never carries live credentials
 * with it. See the "Store authentication per-folder during `clone`"
 * Development Log entries for the reasoning behind this split.
 *
 * Every function below takes the accounts-root directory as its last
 * parameter, defaulted to this real path - tests substitute a temp
 * directory instead, so nothing here ever touches a real `~/.config`.
 */
export declare const ACCOUNTS_ROOT: string;
/** Scratch space for the throwaway login profile used to discover a new/unbound folder's account - see `folderAuth.ts`. */
export declare const TMP_ROOT: string;
export interface AccountMeta {
    appleId: string;
    dsid: string;
}
export declare function accountDir(dsid: string, accountsRoot?: string): string;
export declare function accountSessionPath(dsid: string, accountsRoot?: string): string;
export declare function accountProfileDir(dsid: string, accountsRoot?: string): string;
export declare function writeAccountMeta(meta: AccountMeta, accountsRoot?: string): Promise<void>;
/** Returns `undefined` if this dsid has never been seen on this machine (no `meta.json` yet). */
export declare function readAccountMeta(dsid: string, accountsRoot?: string): Promise<AccountMeta | undefined>;
/**
 * Every account this machine has signed into, newest-irrelevant order (the
 * directory's own). A subdirectory without a readable `meta.json` is skipped
 * rather than reported: it's a half-written account dir, not an account.
 */
export declare function listAccounts(accountsRoot?: string): Promise<AccountMeta[]>;
/**
 * Resolves what a user typed for `--account` - an Apple ID or a raw dsid - to
 * a known account. Apple IDs match case-insensitively, since that's how Apple
 * itself treats them and not how a user remembers typing them. Returns
 * `undefined` when nothing matches, leaving the caller to raise an error that
 * can list the accounts that *are* available.
 */
export declare function findAccount(reference: string, accountsRoot?: string): Promise<AccountMeta | undefined>;
/** A fresh, never-before-used profile directory for the one-time login that discovers a new/unbound folder's account. */
export declare function newEphemeralProfileDir(tmpRoot?: string): Promise<string>;
/**
 * Discards an ephemeral profile that turned out not to be needed (its dsid
 * already had an account, or the login failed). Retries because Chromium can
 * still be flushing files into the profile right after the context closes,
 * which makes a single recursive rm lose the race with an ENOTEMPTY
 * (observed 2026-07-18: that ENOTEMPTY escaped a `finally` and masked the
 * real sign-in error).
 */
export declare function discardEphemeralProfile(dir: string): Promise<void>;
/**
 * Promotes a just-used ephemeral profile into a brand-new account's
 * persisted `browser-profile/`, so it keeps carrying device trust from here
 * on rather than needing fresh 2FA on every future reauth. Same-filesystem
 * rename (both live under the same accounts/tmp root), so this can't fail
 * partway across a device boundary.
 */
export declare function promoteEphemeralProfile(ephemeralDir: string, dsid: string, accountsRoot?: string): Promise<void>;
