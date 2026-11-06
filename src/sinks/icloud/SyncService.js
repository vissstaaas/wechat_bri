import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { SmsMonitorService } from "../../core/sms/SmsMonitorService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");
const CLI_PATH = path.join(PROJECT_ROOT, "node_modules", "icloud-md", "dist", "cli.js");
const OUTBOX_NOTE_PATH = path.join(NOTES_SUBDIR, "发往微信.md");

const OUTBOX_HEADER = `发往微信

> 在本条备忘录末尾写入的内容，会自动发送到你的微信助手。
`;

export class SyncService {
  constructor(tenant) {
    this.tenant = tenant;
    this.isPushing = false;
    this.isPulling = false;
    this.pendingPush = false;
    this.pushTimer = null;
    this.pullTimer = null;
  }

  triggerIcloudPush(delayMs = 2000) {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.executeIcloudPush();
    }, delayMs);
  }

  executeIcloudPush() {
    return new Promise((resolve) => {
      if (this.isPushing) {
        this.pendingPush = true;
        return resolve({ ok: true, queued: true });
      }
      this.isPushing = true;
      this.tenant.addLog("ICLOUD", "正在推送本地备忘录至 iCloud 云上贵州...");

      exec(`node "${CLI_PATH}" push`, { cwd: NOTES_DIR }, (err, stdout, stderr) => {
        this.isPushing = false;
        const nowStr = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        this.tenant.icloud.lastSyncTime = nowStr;

        if (err) {
          const errMsg = (err.message || stderr || "").slice(0, 150);
          this.tenant.addLog("WARN", `iCloud Push 警告: ${errMsg}`);
          resolve({ ok: false, error: errMsg });
        } else {
          this.tenant.addLog("ICLOUD", "✅ iCloud 推送完成，iPhone 备忘录与 Siri 索引已更新");
          resolve({ ok: true, output: stdout });
        }

        if (this.pendingPush) {
          this.pendingPush = false;
          this.executeIcloudPush();
        }
      });
    });
  }

  checkOutboxAndPull(botInstance, saveNoteFn = null) {
    return new Promise((resolve) => {
      if (this.isPulling || this.isPushing) return resolve({ skipped: true });
      this.isPulling = true;

      exec(`node "${CLI_PATH}" pull`, { cwd: NOTES_DIR }, async (err) => {
        this.isPulling = false;
        const nowStr = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        this.tenant.icloud.lastSyncTime = nowStr;

        if (err) return resolve({ ok: false, error: err.message });

        try {
          // 1. 检查发件箱《发往微信.md》
          if (fs.existsSync(OUTBOX_NOTE_PATH)) {
            const content = fs.readFileSync(OUTBOX_NOTE_PATH, "utf-8");

            let body = content;
            if (content.startsWith("---")) {
              const endIdx = content.indexOf("---", 3);
              if (endIdx !== -1) body = content.slice(endIdx + 3).trim();
            }

            const headerMarker = "在本条备忘录末尾写入的内容，会自动发送到你的微信助手。";
            const markerIdx = body.indexOf(headerMarker);
            if (markerIdx !== -1) {
              const userText = body.slice(markerIdx + headerMarker.length).replace(/^[>\s]+/, "").trim();
              if (userText.length > 0 && botInstance) {
                this.tenant.addLog("OUTBOX", `检测到 iPhone《发往微信》新内容: ${userText.slice(0, 60)}`);

                const imgRegex = /!\[.*?\]\((?:attachments\/)?(.*?)\)/g;
                const imagesToSend = [];
                let match;
                while ((match = imgRegex.exec(userText)) !== null) {
                  let rawFileName = match[1];
                  try { rawFileName = decodeURIComponent(rawFileName); } catch {}
                  const baseName = path.basename(rawFileName);
                  const fullImgPath = path.join(ATTACHMENTS_DIR, baseName);
                  if (fs.existsSync(fullImgPath)) imagesToSend.push(fullImgPath);
                }

                const cleanText = userText.replace(imgRegex, "").trim();

                if (imagesToSend.length > 0) {
                  for (let i = 0; i < imagesToSend.length; i++) {
                    const imgPath = imagesToSend[i];
                    const caption = (i === 0 && cleanText) ? `📱 [来自 iPhone 备忘录]\n${cleanText}` : undefined;
                    await botInstance.sendMessage({
                      text: caption,
                      media: { type: "image", url: imgPath }
                    });
                    this.tenant.addLog("WECHAT", `已将备忘录图片发送至手机微信: ${path.basename(imgPath)}`);
                  }
                } else if (cleanText) {
                  await botInstance.sendMessage(`📱 [来自 iPhone 备忘录]\n${cleanText}`);
                  this.tenant.addLog("WECHAT", `已将备忘录文本发送至手机微信: ${cleanText.slice(0, 40)}`);
                }

                const newContent = content.slice(0, content.indexOf(body)) + OUTBOX_HEADER;
                fs.writeFileSync(OUTBOX_NOTE_PATH, newContent, "utf-8");
                this.triggerIcloudPush(1000);
              }
            }
          }

          // 2. 检查手机短信自动流转《短信转发.md》/《信息转发.md》
          await SmsMonitorService.checkAndProcessSmsNotes({
            tenant: this.tenant,
            botInstance,
            saveNoteFn,
            triggerPushFn: (delay) => this.triggerIcloudPush(delay)
          });

          resolve({ ok: true });
        } catch (e) {
          this.tenant.addLog("ERROR", `检查发件箱与短信异常: ${e.message}`);
          resolve({ ok: false, error: e.message });
        }
      });
    });
  }

  startPeriodicPull(botProvider, intervalMs = 5000, saveNoteProvider = null) {
    if (this.pullTimer) clearInterval(this.pullTimer);
    this.pullTimer = setInterval(() => {
      const bot = typeof botProvider === "function" ? botProvider() : botProvider;
      const saveFn = typeof saveNoteProvider === "function" ? saveNoteProvider() : saveNoteProvider;
      if (this.tenant.icloud.connected) {
        this.checkOutboxAndPull(bot, saveFn).catch(() => {});
      }
    }, intervalMs);
  }

  stopPeriodicPull() {
    if (this.pullTimer) {
      clearInterval(this.pullTimer);
      this.pullTimer = null;
    }
  }
}
