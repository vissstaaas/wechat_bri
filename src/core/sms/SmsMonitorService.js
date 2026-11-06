import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { DualModeRouter } from "../router/DualModeRouter.js";
import { TraceBus } from "../trace/TraceBus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const STATE_FILE = path.join(NOTES_DIR, ".sms-monitor-state.json");

export class SmsMonitorService {
  static loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      }
    } catch {}
    return { processedHashes: [] };
  }

  static saveState(state) {
    try {
      if (state.processedHashes.length > 2000) {
        state.processedHashes = state.processedHashes.slice(-2000);
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (e) {
      console.error("[SmsMonitor] 保存状态异常:", e.message);
    }
  }

  static findSmsNoteFiles() {
    if (!fs.existsSync(NOTES_SUBDIR)) return [];
    try {
      return fs.readdirSync(NOTES_SUBDIR)
        .filter(f => f.endsWith(".md") && /(短信|信息转发|短信转发|sms)/i.test(f))
        .map(f => path.join(NOTES_SUBDIR, f));
    } catch {
      return [];
    }
  }

  /**
   * 将多行、带签名（如【中国移动】）的短信智能聚合为完整独立消息块
   */
  static parseSmsBlocks(rawContent) {
    let body = rawContent || "";
    if (body.startsWith("---")) {
      const endIdx = body.indexOf("---", 3);
      if (endIdx !== -1) body = body.slice(endIdx + 3);
    }

    // 移除 markdown 标题、附件与无效占位符
    body = body.replace(/^#\s+[^\r\n]*\r?\n?/gm, "");
    body = body.replace(/\[.*?\]\(attachments\/.*?\)/g, "");

    const rawLines = body.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => {
        if (!l) return false;
        if (l === "123") return false;
        if (l.startsWith("---")) return false;
        if (l.startsWith(">")) return false;
        return true;
      });

    if (rawLines.length === 0) return [];

    const blocks = [];
    let currentBlock = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const isHeaderSig = /^【[^】]{2,15}】$/.test(line);
      const startsWithSig = /^【[^】]{2,15}】/.test(line);
      const isHeader = /^###|\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(line);

      const currentHasBody = currentBlock.some(l => !/^【[^】]{2,15}】$/.test(l));

      // 遇到新的签名或时间标题，且当前块已有正文内容，分割为新消息
      if (currentBlock.length > 0 && currentHasBody && (startsWithSig || isHeader)) {
        blocks.push(currentBlock.join("\n"));
        currentBlock = [];
      }

      currentBlock.push(line);
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join("\n"));
    }

    // 过滤掉只有签名的残缺块（例如结尾孤立的【中国移动】），必须有实际正文
    return blocks
      .map(b => b.trim())
      .filter(b => {
        if (!b) return false;
        if (/^【[^】]{2,15}】$/.test(b)) return false;
        return true;
      });
  }

  /**
   * 极速处理单条短信（无论来自直接 Webhook 还是备忘录轮询）
   */
  static async handleSingleSmsMessage({ messageText, sender = "", tenant, botInstance, saveNoteFn, triggerPushFn }) {
    const cleanText = (messageText || "").trim();
    if (!cleanText || /^【[^】]{2,15}】$/.test(cleanText)) {
      return { skipped: true, reason: "empty_or_signature_only" };
    }

    const fullText = sender ? `[发件人: ${sender}]\n${cleanText}` : cleanText;
    const hash = crypto.createHash("md5").update(cleanText).digest("hex");

    const state = this.loadState();
    const processedSet = new Set(state.processedHashes || []);
    if (processedSet.has(hash)) {
      return { skipped: true, hash };
    }

    processedSet.add(hash);
    state.processedHashes = Array.from(processedSet);
    this.saveState(state);

    const trace = TraceBus.start("sms", cleanText);

    // 1. 意图智能打标与分类
    const intent = DualModeRouter.classifyIntent(cleanText, tenant.rules, false);
    const targetRule = intent.rule;
    trace.step("router", `短信智能分类: 《${targetRule.title}》 (${targetRule.fileName})`);

    // 2. 写入对应分类备忘录
    if (saveNoteFn) {
      saveNoteFn(fullText, targetRule.id);
    } else {
      const destPath = path.join(NOTES_SUBDIR, targetRule.fileName);
      const timeStr = new Date().toLocaleString("zh-CN", { hour12: false });
      const entry = targetRule.isTodo
        ? `\n- [ ] 📱 [短信流转]: ${fullText.replace(/\n/g, " ")} (${timeStr})\n`
        : `\n### ${timeStr} [📱 短信流转]\n${fullText}\n`;
      fs.appendFileSync(destPath, entry, "utf-8");
    }
    trace.step("notes", `归档存入 iPhone 备忘录《${targetRule.fileName}》`);

    tenant.addLog("SMS-MONITOR", `📥 截获完整手机短信: "${cleanText.slice(0, 45).replace(/\n/g, " ")}..." ➔ 已流转至《${targetRule.title}》`);

    // 3. 推送微信即时通知卡片
    if (botInstance) {
      try {
        let categoryIcon = "📱";
        if (targetRule.id === "todo") categoryIcon = "📦 [取件/待办短信]";
        else if (targetRule.id === "key") categoryIcon = "🔑 [验证码/凭据短信]";
        else if (targetRule.id === "link") categoryIcon = "🔗 [链接短信]";

        const senderHeader = sender ? `\n👤 **发件人**：${sender}` : "";
        const msg =
          `${categoryIcon} **收到手机新短信 · 智能流转完成**\n\n` +
          `📝 **短信内容**：\n${cleanText}${senderHeader}\n\n` +
          `🎯 **自动分类**：已归档至《${targetRule.title}》\n` +
          `🎙️ **Siri 语音查询**：\n${targetRule.siriPrompt}`;

        await botInstance.sendMessage(msg);
        trace.step("wechat_push", "推送即时通知卡片至手机微信");
        tenant.addLog("WECHAT", `已将短信流转结果推送到手机微信: ${cleanText.slice(0, 30).replace(/\n/g, " ")}`);
      } catch (e) {
        tenant.addLog("WARN", `推送微信短信提醒失败: ${e.message}`);
      }
    }

    trace.done(`短信流转完成 ➔ 《${targetRule.title}》`);

    if (triggerPushFn) triggerPushFn(2000);

    return { ok: true, targetRule: targetRule.title, hash, cleanText };
  }

  /**
   * 直接通过 HTTP POST 极速接收来自 iOS 快捷指令的 Webhook (< 500ms)
   */
  static async processInboundSmsDirectly({ text, sender = "", tenant, botInstance, saveNoteFn, triggerPushFn }) {
    return await this.handleSingleSmsMessage({
      messageText: text,
      sender,
      tenant,
      botInstance,
      saveNoteFn,
      triggerPushFn
    });
  }

  /**
   * 检查并处理备忘录《短信转发.md》
   */
  static async checkAndProcessSmsNotes({ tenant, botInstance, saveNoteFn, triggerPushFn }) {
    const files = this.findSmsNoteFiles();
    if (files.length === 0) return { processedCount: 0 };

    let processedCount = 0;

    for (const filePath of files) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const blocks = this.parseSmsBlocks(raw);

        for (const block of blocks) {
          const res = await this.handleSingleSmsMessage({
            messageText: block,
            tenant,
            botInstance,
            saveNoteFn,
            triggerPushFn
          });
          if (res.ok) processedCount++;
        }
      } catch (err) {
        tenant.addLog("ERROR", `解析短信文件 ${path.basename(filePath)} 失败: ${err.message}`);
      }
    }

    return { processedCount };
  }
}
