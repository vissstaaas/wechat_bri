/**
 * Apple iCloud Real-Time Probe
 * Validates the session against setup.icloud.com.cn (云上贵州 / Guizhou Cloud).
 * Detects HTTP 421 / 401 and prevents false-online state.
 */
import crypto from "node:crypto";

export class IcloudProbe {
  /**
   * Probe a live session against the Guizhou (mainland China) iCloud node.
   * @param sessionCookie the full "Name=Value; ..." cookie header
   * @param session optional session metadata (clientBuildNumber / clientId) to
   *                mirror the exact web-client build that captured the session.
   */
  static async probeSession(sessionCookie, session = {}) {
    if (!sessionCookie) {
      return { alive: false, reason: "NO_COOKIE", message: "未检测到 iCloud 会话 Cookie" };
    }

    const clientBuildNumber = session.clientBuildNumber || "2610Build20";
    const clientMasteringNumber = session.clientMasteringNumber || "2610Build20";
    const clientId = session.clientId || "dc038370-55d2-4090-9f16-a0a96fb3129a";
    const params = new URLSearchParams({
      clientBuildNumber,
      clientMasteringNumber,
      clientId,
      requestId: crypto.randomUUID()
    });

    try {
      const res = await fetch(
        `https://setup.icloud.com.cn/setup/ws/1/validate?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Origin: "https://www.icloud.com.cn",
            Referer: "https://www.icloud.com.cn/",
            Cookie: sessionCookie,
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(8000)
        }
      );

      if (res.status === 421 || res.status === 401) {
        return {
          alive: false,
          reason: "SESSION_EXPIRED",
          status: res.status,
          message: `iCloud 凭证已过期 (HTTP ${res.status})，需要重新认证`
        };
      }

      if (!res.ok) {
        return {
          alive: false,
          reason: `HTTP_${res.status}`,
          status: res.status,
          message: `iCloud 校验返回异常 HTTP ${res.status}`
        };
      }

      const data = await res.json();
      // Partially-authenticated (password ok, 2FA pending) must NOT count as online.
      if (data.hsaChallengeRequired === true || data.dsInfo?.hsaChallengeRequired === true) {
        return { alive: false, reason: "PARTIAL_2FA", message: "会话仅部分认证（2FA 待完成）" };
      }

      const dsInfo = data.dsInfo || {};
      const webservices = data.webservices || {};
      return {
        alive: true,
        reason: "OK",
        fullName: dsInfo.fullName || "iCloud User",
        dsid: String(dsInfo.dsid || ""),
        appleId: dsInfo.appleId,
        // Guizhou node endpoints for CloudKit (Notes), CloudDocs docs (upload/download), and Drive (folder list)
        notesUrl: webservices.ckdatabasews?.url,
        driveUrl: webservices.drivews?.url,
        docUrl: webservices.docws?.url,
        webservices,
        message: "iCloud 会话有效（云上贵州）"
      };
    } catch (e) {
      return { alive: false, reason: "NETWORK_ERROR", message: `iCloud 探测网络异常: ${e.message}` };
    }
  }
}
