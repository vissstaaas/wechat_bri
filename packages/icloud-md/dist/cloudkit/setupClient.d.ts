import type { IcloudSession } from "../session.js";
export type AuthCheckResult = {
    ok: true;
    dsid: string;
    appleId: string;
    fullName: string | undefined;
    /** Base URL of the CloudKit database web service for this account's partition, e.g. https://p43-ckdatabasews.icloud.com:443 */
    ckdatabasewsUrl: string | undefined;
    /**
     * The passed-in session with any `Set-Cookie` rotation from this call merged
     * in (same object, unchanged, if nothing rotated). `/validate` rotates
     * `X-APPLE-WEBAUTH-TOKEN` on every call, same as the browser's own
     * heartbeat - callers should use this session for subsequent requests and
     * persist it if it differs from what they passed in, or the rotated token
     * supersedes the one they keep re-presenting.
     */
    session: IcloudSession;
} | {
    ok: false;
    status: number;
    error: string;
};
/**
 * Hits the same endpoint the icloud.com web client uses on page load to confirm
 * an existing session is still valid. Doubles as account bootstrap: a successful
 * response carries the account's dsid and per-service partition hosts (e.g. which
 * `p<N>-ckdatabasews.icloud.com` to talk to for CloudKit calls).
 */
export declare function checkAuthentication(session: IcloudSession, dsid?: string): Promise<AuthCheckResult>;
