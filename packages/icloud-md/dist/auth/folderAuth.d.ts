import { checkAuthentication } from "../cloudkit/setupClient.js";
import { type CloneStateAccount } from "../notes/cloneState.js";
import { performBrowserLogin } from "./browserLogin.js";
import { ensureAuthenticated, type AuthCheckOk } from "./ensureAuthenticated.js";
export type FolderAuth = AuthCheckOk;
/**
 * Shared by all three functions below. `onStatus` defaults to a no-op (not
 * `console.log`) so they stay side-effect-free as library functions, same as
 * `runClone`/`runPull` themselves - the CLI layer is the only place that
 * should print. The rest exist purely so tests can substitute a fake
 * login/verification flow and a temp accounts directory instead of driving a
 * real browser against `~/.config`.
 */
interface CommonDeps {
    onStatus?: ((message: string) => void) | undefined;
    performBrowserLogin?: typeof performBrowserLogin;
    checkAuthentication?: typeof checkAuthentication;
    accountsRoot?: string;
}
/**
 * May a sign-in that needs a human open a *visible* browser window?
 *
 * `true` (the default) is the person-at-a-terminal case the `clone` command
 * was written for. `false` is for unattended callers - CI, cron, the live
 * integration suite - where a window has nobody to complete it, so raising
 * `InteractiveSignInRefusedError` immediately is strictly better than
 * blocking on one. Headless attempts are unaffected either way: they open
 * nothing and either succeed on their own or fail quickly.
 */
interface InteractiveDep {
    interactive?: boolean;
}
export interface BindNewFolderAccountDeps extends CommonDeps, InteractiveDep {
    tmpRoot?: string;
}
/**
 * Used by `clone` on a brand-new (never-cloned) folder: always runs a real
 * interactive login through a fresh, throwaway profile - never one of the
 * existing persisted per-account profiles, and never a shared "picker"
 * profile either, since either would let iCloud's own session cookies
 * silently auto-resume as whoever last used it, defeating the point of
 * asking. Once sign-in completes, the real dsid tells us which account this
 * is: an existing account's stored session just gets refreshed (its own
 * profile left untouched, already trusted); a brand-new dsid gets its own
 * account directory, with the ephemeral profile promoted into it so it too
 * gets device-trust reuse starting next time, instead of paying for fresh
 * 2FA on every future reauth. The caller (`clone`) is responsible for
 * recording the returned identity into that folder's `state.json`.
 */
export declare function bindNewFolderAccount(deps?: BindNewFolderAccountDeps): Promise<FolderAuth>;
/**
 * Used by `clone --account <appleId|dsid>`: binds a brand-new folder to an
 * account this machine has *already* signed into.
 *
 * `bindNewFolderAccount` deliberately refuses to reuse a persisted profile,
 * but its objection is to reusing one *silently* - a shared profile would let
 * iCloud's cookies decide the account, so the user could not tell which one
 * they got. Naming the account removes exactly that ambiguity: the caller has
 * said which identity they want, and whatever authenticates is checked against
 * it, so an unexpected account is an error rather than a silent substitution.
 *
 * Three attempts, cheapest first:
 *
 *  1. That account's *stored session* - the same one `pull`/`push` use, and
 *     the only step that touches no browser at all (see `reuseStoredSession`).
 *  2. A headless relaunch of the account's own Apple-trusted profile, which
 *     usually re-validates with no interaction.
 *  3. A visible window, since a human can finish what the profile couldn't -
 *     expired device trust, a fresh 2FA prompt, a CAPTCHA. Skipped, as a
 *     refusal, when `interactive` is false.
 */
export declare function bindKnownAccount(reference: string, deps?: CommonDeps & InteractiveDep): Promise<FolderAuth>;
export interface ResolveFolderAccountDeps extends CommonDeps {
    ensureAuthenticated?: typeof ensureAuthenticated;
}
/**
 * Used by `pull`/`push`/`verify-auth`: resolves an already-cloned folder's
 * bound account to a live, verified session - transparently, no flag, no
 * visible "account" concept. `account` should come from that folder's
 * already-loaded `state.json` (callers already read it for their own
 * purposes, so this doesn't re-read the file). Headless 421 recovery reuses
 * that same account's own persisted browser profile, and the resulting
 * identity is re-checked against `account` either way - a mismatch throws
 * `AccountMismatchError` rather than silently trusting whatever came back.
 */
export declare function resolveFolderAccount(targetDir: string, account: CloneStateAccount | undefined, deps?: ResolveFolderAccountDeps): Promise<FolderAuth>;
export type ReauthenticateFolderDeps = CommonDeps;
/**
 * Used by `reauthenticate <dir>`: forces a fresh interactive login against
 * an already-cloned folder's bound account, via that account's own
 * persisted profile (so device trust still applies and 2FA is typically
 * still skipped). Refuses - `AccountMismatchError` - if the completed
 * sign-in turns out to be for a different Apple ID than the one this folder
 * was cloned for, rather than silently rebinding it.
 */
export declare function reauthenticateFolder(targetDir: string, deps?: ReauthenticateFolderDeps): Promise<FolderAuth>;
export {};
