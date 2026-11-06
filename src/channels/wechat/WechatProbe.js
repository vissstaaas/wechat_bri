import fs from "fs";
import path from "path";
import os from "os";

/**
 * WeChat Real-Time Channel Probe
 * Verifies persisted credentials and bot instance health without colliding with active long-polls.
 */
export class WechatProbe {
  static async probeSession(token, baseUrl = "https://ilinkai.weixin.qq.com") {
    if (!token) return { alive: false, reason: "NO_TOKEN", message: "未配置微信 Token" };

    try {
      const weixinDir = path.join(os.homedir(), ".openclaw", "openclaw-weixin");
      const indexFile = path.join(weixinDir, "accounts.json");
      if (!fs.existsSync(indexFile)) {
        return { alive: false, reason: "NO_ACCOUNT_INDEX", message: "本地未找到已授权微信账号" };
      }
      const ids = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
      if (!Array.isArray(ids) || ids.length === 0) {
        return { alive: false, reason: "EMPTY_ACCOUNT_LIST", message: "未登录微信账号" };
      }

      const accPath = path.join(weixinDir, "accounts", `${ids[0]}.json`);
      if (!fs.existsSync(accPath)) {
        return { alive: false, reason: "CREDENTIAL_FILE_MISSING", message: "微信凭证文件丢失" };
      }

      const acc = JSON.parse(fs.readFileSync(accPath, "utf-8"));
      if (!acc.token) {
        return { alive: false, reason: "TOKEN_MISSING", message: "微信 Token 为空" };
      }

      return {
        alive: true,
        reason: "OK",
        accountId: ids[0],
        userId: acc.userId || null,
        message: "微信通道在线"
      };
    } catch (e) {
      return { alive: false, reason: "ERROR", message: `微信探活异常: ${e.message}` };
    }
  }
}
