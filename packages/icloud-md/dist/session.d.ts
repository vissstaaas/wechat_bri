/** A captured browser session: enough to make authenticated iCloud web-service requests. */
export interface IcloudSession {
    cookie: string;
    clientId: string;
    clientBuildNumber: string;
    clientMasteringNumber: string;
    capturedAt: string;
}
/**
 * Every session file lives under a specific Apple ID's own directory (see
 * `accountStore.ts`'s `accountSessionPath`), not at one shared path - a
 * machine can hold sessions for more than one account, each folder bound to
 * whichever one it was cloned for.
 */
export declare function loadSession(sessionPath: string): Promise<IcloudSession>;
/** Writes a session file with the same permissions convention import-har/login both rely on. */
export declare function writeSessionFile(session: IcloudSession, sessionPath: string): Promise<void>;
/** Parses a `Name1=Value1; Name2=Value2` cookie header into a name→value map, preserving order. */
export declare function parseCookieHeader(cookieHeader: string): Map<string, string>;
/** Extracts just the `Name=Value` pair from one `Set-Cookie` response header, ignoring its attributes. */
export declare function parseSetCookieName(setCookieHeader: string): {
    name: string;
    value: string;
} | undefined;
/**
 * Merges rotated cookies from a response's `Set-Cookie` headers into a session's
 * cookie jar. Every `/validate` call rotates `X-APPLE-WEBAUTH-TOKEN` the same way
 * the browser's own 14-minute heartbeat does (see the dev notes); previously we
 * discarded that rotation and kept re-presenting the superseded token. Existing
 * cookie order is preserved (a rotated value updates in place); brand-new cookie
 * names are appended. Returns the same `session` object, unchanged, if nothing
 * actually rotated.
 */
export declare function mergeSetCookiesIntoSession(session: IcloudSession, setCookieHeaders: readonly string[]): IcloudSession;
/** Writes `next` to disk only if its cookie jar actually differs from `previous` - avoids a pointless write on every call. */
export declare function persistSessionIfRotated(previous: IcloudSession, next: IcloudSession, sessionPath: string): Promise<void>;
