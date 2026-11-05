import { mergeSetCookiesIntoSession } from "../session.js";
import { loggedFetch } from "../debugLog.js";
const SETUP_HOST = "https://setup.icloud.com";
/**
 * Hits the same endpoint the icloud.com web client uses on page load to confirm
 * an existing session is still valid. Doubles as account bootstrap: a successful
 * response carries the account's dsid and per-service partition hosts (e.g. which
 * `p<N>-ckdatabasews.icloud.com` to talk to for CloudKit calls).
 */
export async function checkAuthentication(session, dsid) {
    const params = new URLSearchParams({
        clientBuildNumber: session.clientBuildNumber,
        clientMasteringNumber: session.clientMasteringNumber,
        clientId: session.clientId,
        requestId: crypto.randomUUID(),
    });
    if (dsid) {
        params.set("dsid", dsid);
    }
    const activeHost = session.setupHost || (session.cookie.includes("icloud.com.cn") ? "https://setup.icloud.com.cn" : SETUP_HOST);
    const activeOrigin = activeHost.replace("setup.", "www.");
    const response = await loggedFetch("checkAuthentication", `${activeHost}/setup/ws/1/validate?${params.toString()}`, {
        method: "POST",
        headers: {
            Cookie: session.cookie,
            Origin: activeOrigin,
            Referer: activeOrigin + "/",
            Accept: "application/json",
        },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const error = isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
        return { ok: false, status: response.status, error };
    }
    const rotatedSession = mergeSetCookiesIntoSession(session, response.headers.getSetCookie());
    if (!isRecord(body) || !isRecord(body.dsInfo)) {
        return { ok: false, status: response.status, error: "Unexpected response shape from /validate (missing dsInfo)" };
    }
    // A partially-authenticated session (password accepted, 2FA still pending)
    // also answers 200 here - never treat it as signed in, or a login captured
    // mid-2FA gets written out as if it were a working session.
    if (body.hsaChallengeRequired === true || body.dsInfo.hsaChallengeRequired === true) {
        return { ok: false, status: response.status, error: "Session is only partially authenticated (2FA challenge pending)" };
    }
    const dsInfo = body.dsInfo;
    const appleId = typeof dsInfo.appleId === "string" ? dsInfo.appleId : undefined;
    const resolvedDsid = typeof dsInfo.dsid === "string" ? dsInfo.dsid : undefined;
    const fullName = typeof dsInfo.fullName === "string" ? dsInfo.fullName : undefined;
    if (!appleId || !resolvedDsid) {
        return { ok: false, status: response.status, error: "Missing appleId/dsid in /validate response" };
    }
    const webservices = isRecord(body.webservices) ? body.webservices : undefined;
    const notesService = webservices && isRecord(webservices.ckdatabasews) ? webservices.ckdatabasews : undefined;
    const ckdatabasewsUrl = notesService && typeof notesService.url === "string" ? notesService.url : undefined;
    return { ok: true, dsid: resolvedDsid, appleId, fullName, ckdatabasewsUrl, session: rotatedSession };
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=setupClient.js.map