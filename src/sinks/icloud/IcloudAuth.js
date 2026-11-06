import path from "path";
import os from "os";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { bindNewFolderAccount, reauthenticateFolder } from "icloud-md/dist/auth/folderAuth.js";
import { IcloudProbe } from "./IcloudProbe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");

export const ICLOUD_LOGIN_STAGES = {
  IDLE: "idle",
  BROWSER_OPEN: "browser_open",
  VERIFYING: "verifying",
  CLONING: "cloning",
  DONE: "done",
  FAILED: "failed"
};

export class IcloudAuthManager {
  constructor(tenant) {
    this.tenant = tenant;
    this.state = {
      stage: ICLOUD_LOGIN_STAGES.IDLE,
      message: "",
      error: "",
      appleId: ""
    };
    this.lastCheckAt = 0;
    this.cachedAlive = null;
    this.cachedNodes = null;
  }

  updateStage(stage, message, extra = {}) {
    Object.assign(this.state, { stage, message, error: "", ...extra });
    this.tenant.addLog("ICLOUD-AUTH", message);
  }

  fail(error) {
    this.state.stage = ICLOUD_LOGIN_STAGES.FAILED;
    this.state.error = error;
    this.state.message = "";
    this.tenant.addLog("ERROR", `iCloud 登录失败: ${error}`);
  }

  getExistingMeta(notesDir = NOTES_DIR) {
    try {
      if (notesDir && fs.existsSync(notesDir)) {
        const stateFile = path.join(notesDir, ".icloud-md", "state.json");
        if (fs.existsSync(stateFile)) {
          const s = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
          if (s?.account?.appleId) {
            return s.account;
          }
        }
      }
    } catch {}

    try {
      const accDir = path.join(os.homedir(), ".config", "icloud-md", "accounts");
      if (fs.existsSync(accDir)) {
        const dsids = fs.readdirSync(accDir).filter(d => fs.statSync(path.join(accDir, d)).isDirectory());
        for (const dsid of dsids) {
          const metaPath = path.join(accDir, dsid, "meta.json");
          if (fs.existsSync(metaPath)) {
            const m = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            if (m.appleId) return { appleId: m.appleId, dsid: String(m.dsid || dsid) };
          }
        }
      }
    } catch {}

    return null;
  }

  readSession(dsid) {
    if (!dsid) return null;
    const sessionPath = path.join(os.homedir(), ".config", "icloud-md", "accounts", String(dsid), "session.local.json");
    try {
      if (!fs.existsSync(sessionPath)) return null;
      const s = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      if (!s.cookie) return null;
      return s;
    } catch {
      return null;
    }
  }

  async checkAccountAlive(dsid) {
    if (!dsid) return false;
    const now = Date.now();
    if (this.cachedAlive !== null && (now - this.lastCheckAt) < 15000) {
      return this.cachedAlive;
    }

    const session = this.readSession(dsid);
    if (!session) {
      this.cachedAlive = false;
      this.lastCheckAt = now;
      return false;
    }

    const probe = await IcloudProbe.probeSession(session.cookie, session);
    this.cachedAlive = probe.alive === true;
    this.lastCheckAt = now;

    if (probe.alive) {
      this.cachedNodes = {
        notesUrl: probe.notesUrl,
        driveUrl: probe.driveUrl,
        docUrl: probe.docUrl,
        dsid: probe.dsid || String(dsid)
      };
      this.tenant.icloud.notesUrl = probe.notesUrl;
      this.tenant.icloud.driveUrl = probe.driveUrl;
      this.tenant.icloud.docUrl = probe.docUrl;
      this.tenant.icloud.connected = true;
      this.tenant.icloud.status = "ONLINE";
      this.tenant.icloud.appleId = probe.appleId || this.tenant.icloud.appleId;
      this.tenant.icloud.dsid = String(dsid);
    } else {
      this.tenant.icloud.connected = false;
      this.tenant.icloud.status = "EXPIRED";
    }

    return this.cachedAlive;
  }

  async getLoginSnapshot(notesDir = NOTES_DIR) {
    const meta = this.getExistingMeta(notesDir);
    if (!meta?.appleId) {
      return { stage: ICLOUD_LOGIN_STAGES.IDLE, message: "尚未登录 iCloud", error: "", appleId: "" };
    }

    const isAlive = await this.checkAccountAlive(meta.dsid);
    if (isAlive) {
      this.state.stage = ICLOUD_LOGIN_STAGES.DONE;
      return {
        stage: ICLOUD_LOGIN_STAGES.DONE,
        message: `iCloud 已连接：${meta.appleId}（云上贵州）`,
        error: "",
        appleId: meta.appleId
      };
    }

    if ([ICLOUD_LOGIN_STAGES.BROWSER_OPEN, ICLOUD_LOGIN_STAGES.VERIFYING, ICLOUD_LOGIN_STAGES.CLONING].includes(this.state.stage)) {
      return { ...this.state };
    }

    return {
      stage: ICLOUD_LOGIN_STAGES.IDLE,
      message: `iCloud 凭证已过期 (${meta.appleId}，HTTP 421)，请点击重新登录`,
      error: "HTTP 421",
      appleId: meta.appleId,
      needsRelogin: true
    };
  }

  async startLogin(notesDir = NOTES_DIR) {
    const busy = [ICLOUD_LOGIN_STAGES.BROWSER_OPEN, ICLOUD_LOGIN_STAGES.VERIFYING, ICLOUD_LOGIN_STAGES.CLONING];
    if (busy.includes(this.state.stage)) {
      console.log("[iCloud Login] 已在登录流程中，无需重复打开");
      return;
    }

    this.cachedAlive = null;
    this.cachedNodes = null;

    const meta = this.getExistingMeta(notesDir);
    const mode = meta?.dsid ? "reauth" : "bind";

    this.updateStage(
      ICLOUD_LOGIN_STAGES.BROWSER_OPEN,
      "已弹出 iCloud 登录窗口（云上贵州），请在新窗口完成 Apple ID 登录（含验证码）..."
    );

    try {
      let auth;
      if (mode === "bind") {
        auth = await bindNewFolderAccount({
          onStatus: (t) => this.tenant.addLog("ICLOUD-AUTH", t)
        });
      } else {
        auth = await reauthenticateFolder(notesDir, {
          onStatus: (t) => this.tenant.addLog("ICLOUD-AUTH", t)
        });
      }

      this.updateStage(ICLOUD_LOGIN_STAGES.VERIFYING, `已获取 ${auth.appleId} 凭据，正在校验云上贵州节点...`);

      const alive = await this.checkAccountAlive(auth.dsid);
      if (!alive) {
        this.fail("登录完成但云上贵州会话校验未通过，请重试");
        return;
      }

      this.tenant.icloud.appleId = auth.appleId;
      this.tenant.icloud.dsid = String(auth.dsid);
      this.tenant.icloud.connected = true;
      this.tenant.icloud.status = "ONLINE";
      this.tenant.icloud.errorMessage = "";
      this.updateStage(ICLOUD_LOGIN_STAGES.DONE, `iCloud 已连接：${auth.appleId}（云上贵州）`, { appleId: auth.appleId });
    } catch (err) {
      this.fail("iCloud 登录失败: " + (err.message || String(err)));
    }
  }
}
