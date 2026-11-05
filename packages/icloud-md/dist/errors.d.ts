export interface IcloudNotesSyncErrorOptions extends ErrorOptions {
    hint?: string;
}
/**
 * Base for known, "expected" failure modes - a library consumer can catch
 * this broadly to distinguish them from genuine bugs, while the CLI prints
 * `message` (and `hint`, if present) without a stack trace. Anything not an
 * instance of this stays a plain `Error` and keeps its raw stack trace, since
 * that means something actually went wrong that needs debugging.
 */
export declare class IcloudNotesSyncError extends Error {
    readonly hint?: string;
    constructor(message: string, options?: IcloudNotesSyncErrorOptions);
}
export declare class AuthenticationExpiredError extends IcloudNotesSyncError {
    constructor(status: number, detail: string);
}
/**
 * Covers both the headless-recovery attempt throwing outright, and the case
 * where recovery "succeeded" but the resulting session still fails
 * verification - either way, the persistent browser profile can't get back
 * in on its own and a human needs to complete an interactive sign-in.
 */
export declare class SilentReauthFailedError extends IcloudNotesSyncError {
    constructor(message: string, options?: ErrorOptions);
}
export declare class UntrackedFileError extends IcloudNotesSyncError {
    constructor(fileName: string, targetDir: string, options?: {
        hint?: string;
    });
}
export declare class NotClonedDirectoryError extends IcloudNotesSyncError {
    constructor(targetDir: string);
}
export declare class AmbiguousTrackedFileError extends IcloudNotesSyncError {
    constructor(baseName: string, candidates: readonly string[]);
}
export declare class UnsupportedVaultLayoutError extends IcloudNotesSyncError {
    constructor(targetDir: string);
}
/**
 * The vault was written by a newer icloud-md than this one. Vaults migrate
 * forward automatically, so running an older build against one it has already
 * touched is a real possibility - and the only safe answer is to upgrade.
 * Deliberately distinct from `UnsupportedVaultLayoutError`, whose "re-clone
 * into a fresh directory" advice would be destructive here.
 */
export declare class VaultFromNewerToolError extends IcloudNotesSyncError {
    constructor(targetDir: string, vaultVersion: number, supportedVersion: number);
}
export declare class MissingSessionFileError extends IcloudNotesSyncError {
    constructor(sessionPath: string, options?: ErrorOptions);
}
/** The session file exists but isn't (or is no longer) a valid `IcloudSession` - hand-edited, truncated, or from an incompatible version. */
export declare class CorruptSessionFileError extends IcloudNotesSyncError {
    constructor(message: string);
}
export declare class ChromiumNotInstalledError extends IcloudNotesSyncError {
    constructor(options?: ErrorOptions);
}
/** Covers every way an interactive/headless browser login can end without a usable session: no cookies captured, the wait timed out, or the window was closed early. */
export declare class SignInIncompleteError extends IcloudNotesSyncError {
    constructor(message: string, options?: ErrorOptions);
}
export declare class NotesUnavailableError extends IcloudNotesSyncError {
    constructor();
}
/** A tracked directory's `.icloud-md/state.json` doesn't match the shape `clone`/`pull`/`push` produce - hand-edited, truncated, or from an incompatible version. */
export declare class CorruptStateFileError extends IcloudNotesSyncError {
    constructor(message: string);
}
/** `clone` only ever performs the initial export into a directory - mirrors `git clone`'s own refusal to run against a non-empty destination. */
export declare class AlreadyClonedDirectoryError extends IcloudNotesSyncError {
    constructor(targetDir: string);
}
/** A folder's state.json predates per-folder account binding (or was hand-edited to drop it) - there's no account to resolve a session for. */
export declare class UnboundAccountError extends IcloudNotesSyncError {
    constructor(targetDir: string);
}
/**
 * A folder is bound to one Apple ID, but the session just authenticated (via
 * `reauthenticate`, or headless 421 recovery) is for a different one. Refuses
 * rather than silently rebinding the folder to a new account - that would
 * risk `pull`/`push` quietly mixing one person's notes into another's vault.
 */
/**
 * `clone --account <ref>` named an account this machine has never signed
 * into. The hint lists the accounts that *are* available, because the usual
 * cause is a typo or a half-remembered Apple ID, and the fix is visible from
 * that list.
 */
export declare class UnknownAccountError extends IcloudNotesSyncError {
    constructor(reference: string, known: readonly string[]);
}
/**
 * `clone --account <ref>` completed a sign-in for a different Apple ID than
 * the one requested - the trusted profile resumed as somebody else. Distinct
 * from `AccountMismatchError`, which is about an *existing* clone's binding;
 * here nothing has been cloned yet, so the wording is about the request.
 */
export declare class RequestedAccountMismatchError extends IcloudNotesSyncError {
    constructor(requested: string, actualAppleId: string);
}
/**
 * A sign-in needing a human came up while running `--non-interactive`.
 *
 * Opening a window in an unattended context is worse than failing: nobody is
 * there to complete it, so the command blocks until something closes it (the
 * live integration suite paid 5.5 minutes per clone this way on 2026-08-02
 * before giving up). Failing immediately says what actually happened.
 */
export declare class InteractiveSignInRefusedError extends IcloudNotesSyncError {
    constructor(message: string, options?: ErrorOptions);
}
export declare class AccountMismatchError extends IcloudNotesSyncError {
    constructor(targetDir: string, expectedAppleId: string, actualAppleId: string);
}
/**
 * A CloudKit/network request came back non-OK with only an HTTP status to go
 * on - could be a transient network or service blip, could be a real
 * protocol-level bug. There's no specific fix to point at either way, so the
 * hint defaults to generic advice; a caller (or subclass) with a more
 * specific diagnosis can pass its own. The message keeps the
 * operation/status detail for anyone filing an issue.
 */
export declare class CloudKitRequestFailedError extends IcloudNotesSyncError {
    constructor(message: string, options?: IcloudNotesSyncErrorOptions);
}
/**
 * A zone-level failure delivered inside an HTTP 200 `changes/zone` response:
 * the zone entry carries `serverErrorCode`/`reason` instead of records. The
 * code is exposed as a field so callers can react to one specific condition
 * (e.g. tolerating ZONE_NOT_FOUND for a shared zone whose share was revoked)
 * without string-matching the message. ZONE_NOT_FOUND also replaces the
 * generic "wait and retry" hint, which is actively wrong for a zone that no
 * longer exists - retrying fails identically every time.
 */
export declare class CloudKitZoneFetchFailedError extends CloudKitRequestFailedError {
    readonly serverErrorCode: string;
    constructor(serverErrorCode: string, reason: string);
}
/** A `history`/`diff`/`revert` snapshot id that doesn't match any recorded
 * version for the given file - either mistyped, or from a different file's
 * history. */
export declare class UnknownVersionSnapshotError extends IcloudNotesSyncError {
    constructor(id: string, fileName: string);
}
/** `delete` fetched a fresh recordChangeTag immediately before writing, so a
 * rejection here means something changed the note in that narrow window
 * (or a genuine CloudKit-side problem) rather than the stale-tag conflict
 * `push` routinely expects. */
export declare class NoteDeleteRejectedError extends IcloudNotesSyncError {
    constructor(fileName: string, serverErrorCode: string, reason: string | undefined);
}
/** `object show`/`object delete` looked up a recordName that doesn't
 * resolve to anything in the zone. */
export declare class UnknownObjectError extends IcloudNotesSyncError {
    constructor(recordName: string, options?: {
        maybeDeleted?: boolean;
    });
}
/** `object delete --force` found the target blocked by referrers it won't
 * cascade into: a Folder or another Note is collateral, not per-note
 * cleanup, so it stops and names them instead. */
export declare class ObjectForceDeleteBlockedError extends IcloudNotesSyncError {
    constructor(recordName: string, blockers: readonly {
        recordName: string;
        recordType: string;
    }[]);
}
/** Deleting a structural record (a Folder) detaches everything under it -
 * unlike a Note or Attachment, where naming the ID is intent enough, this
 * needs an explicit --yes. */
export declare class ObjectDeleteNeedsConfirmationError extends IcloudNotesSyncError {
    constructor(recordType: string, recordName: string);
}
/** `diff`/`revert` couldn't read the content needed on one side of the
 * comparison (or write-back) - the target record vanished remotely, is no
 * longer in a readable state, or a historical snapshot no longer decodes
 * cleanly against the current model. */
export declare class VersionContentUnavailableError extends IcloudNotesSyncError {
    constructor(reason: string);
}
