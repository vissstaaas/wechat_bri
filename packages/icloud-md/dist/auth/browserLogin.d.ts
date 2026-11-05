import type { IcloudSession } from "../session.js";
/**
 * Browser-driven login: open a real (headed) browser window on www.icloud.com,
 * let the user - and Apple's own JavaScript - do the entire sign-in dance
 * (password, whatever 2FA variant the account uses, CAPTCHAs, interstitials),
 * then harvest the resulting session cookies once the page's own
 * setup.icloud.com bootstrap call succeeds.
 *
 * This deliberately owns none of the idmsa.apple.com protocol surface: Apple's
 * pages execute whatever this month's login flow is, and all we depend on is
 * the shape of the *result* (a cookie jar for .icloud.com plus the client
 * query params), which is the same thing the HAR-import path already proved
 * sufficient.
 */
/**
 * The login browser's own persistent state (cookies, local storage, and the
 * device trust Apple grants after a completed 2FA). Reusing one profile means
 * repeat logins look like a returning browser and typically skip 2FA entirely.
 */
export declare const DEFAULT_BROWSER_PROFILE_DIR: string;
/**
 * True only for a *fully* signed-in accountLogin/validate response body: the
 * account info is present and no 2FA challenge is still pending. The partial
 * (pre-2FA) response otherwise looks deceptively complete - it even includes
 * the `webservices.ckdatabasews` entry - so `hsaChallengeRequired` is the
 * discriminator, not any of the fields we actually consume.
 */
export declare function isFullySignedInBody(body: unknown): boolean;
/** The subset of Playwright's cookie shape the capture logic needs. */
export interface CapturedCookie {
    name: string;
    value: string;
    domain: string;
}
/** True for icloud.com and any subdomain, with or without a leading dot. */
export declare function isIcloudDomain(domain: string): boolean;
/**
 * Builds the verbatim Cookie header the rest of the client sends to
 * setup.icloud.com/ckdatabasews. Mirrors the HAR-import approach: forward the
 * whole icloud.com jar rather than guessing which cookies matter (see the
 * open question in the dev notes about which ones are actually required).
 */
export declare function buildIcloudCookieHeader(cookies: readonly CapturedCookie[]): string;
export interface ClientParams {
    clientId: string | undefined;
    clientBuildNumber: string | undefined;
    clientMasteringNumber: string | undefined;
}
/** Pulls the web client's identifying query params off a setup.icloud.com request URL. */
export declare function extractClientParams(url: string): ClientParams;
/**
 * Assembles an IcloudSession from a captured cookie jar and the setup call's
 * URL. Client params come from the observed request itself (so they track
 * whatever web-client build actually just logged in) with the static defaults
 * as fallback. Device trust lives in the persistent browser profile, not the
 * session file.
 */
export declare function sessionFromBrowserCapture(cookies: readonly CapturedCookie[], setupRequestUrl: string, capturedAt?: Date): IcloudSession;
export interface BrowserLoginOptions {
    profileDir?: string;
    onStatus?: (message: string) => void;
    /**
     * Run without a visible window. Only meaningful for the persistent profile:
     * a profile Apple already trusts can sometimes complete sign-in with no
     * interaction at all (the same silent recovery a live browser tab performs
     * after its own session lapses - see the 2026-07-13 dev notes). A profile
     * that actually needs a human (fresh 2FA, CAPTCHA) will just sit waiting
     * with nothing able to click through it, so headless callers should also
     * pass `timeoutMs`. Defaults to `false` (the interactive `login` command).
     */
    headless?: boolean;
    /**
     * Give up waiting for sign-in to complete after this many milliseconds.
     * `0` (the default) waits forever, appropriate for the interactive command
     * where a human is at the window. Headless/automated recovery should pass
     * a real value so a profile that can't recover silently fails fast instead
     * of hanging the calling command indefinitely.
     */
    timeoutMs?: number;
}
/** Playwright's own message when a browser's binary hasn't been downloaded yet (matched the same way Playwright's CLI itself detects this failure). */
export declare function isMissingChromiumError(error: unknown): boolean;
/**
 * Absolute path to the bundled Playwright package's own CLI entrypoint
 * (`cli.js`, the target of its "bin" field). It isn't in playwright's exports
 * map, so it can't be resolved by specifier - but `playwright/package.json`
 * is exported, and `cli.js` sits beside it.
 */
export declare function resolvePlaywrightCli(): string;
/**
 * Opens the login window and resolves with a captured session once sign-in
 * completes. Rejects if the user closes the window first (interactive mode)
 * or if `timeoutMs` elapses (headless mode). The window is always closed
 * afterwards - the browser never lingers, so its own 14-minute /validate
 * heartbeat can't race the captured token the way a live tab raced
 * HAR-imported sessions.
 */
export declare function performBrowserLogin(options?: BrowserLoginOptions): Promise<IcloudSession>;
