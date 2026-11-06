import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import qrcodeterminal from "qrcode-terminal";
import { start, isLoggedIn, logout } from "weixin-agent-sdk";
import { DualModeRouter } from "../../core/router/DualModeRouter.js";
import { AgentService, searchNotes } from "../../core/router/AgentService.js";
import { NotesService } from "../../sinks/icloud/NotesService.js";
import { DriveService } from "../../sinks/icloud/DriveService.js";
import { SyncService } from "../../sinks/icloud/SyncService.js";
import { analyzeAndIndexNewPhoto, getAllIndexedPhotos } from "../../core/photo-index-engine.js";
import { normalizeImageFileName } from "../../core/wechat-image-embedder.js";
import { TraceBus } from "../../core/trace/TraceBus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const MEDIA_SAVE_DIR = path.join(PROJECT_ROOT, "wechat_media");
const INBOX_NOTE_PATH = path.join(NOTES_SUBDIR, "微信收集箱.md");

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID = "bot";
const ILINK_CLIENT_VERSION = String((0 << 16) | (6 << 8) | 0);
const QR_SESSION_TTL_MS = 5 * 60 * 1000;
const QR_LONG_POLL_TIMEOUT_MS = 35000;

if (!fs.existsSync(MEDIA_SAVE_DIR)) fs.mkdirSync(MEDIA_SAVE_DIR, { recursive: true });
if (!fs.existsSync(NOTES_SUBDIR)) fs.mkdirSync(NOTES_SUBDIR, { recursive: true });

function buildIlinkCommonHeaders() {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": ILINK_CLIENT_VERSION
  };
}

function buildIlinkPostHeaders() {
  const randomUin = Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64");
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomUin,
    ...buildIlinkCommonHeaders()
  };
}

function getLocalStoredTokens() {
  const tokens = [];
  try {
    const accountsDir = path.join(os.homedir(), ".openclaw", "openclaw-weixin", "accounts");
    if (fs.existsSync(accountsDir)) {
      const files = fs.readdirSync(accountsDir).filter(f => f.endsWith(".json") && !f.includes(".context-tokens") && !f.includes(".sync"));
      for (const file of files) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(accountsDir, file), "utf-8"));
          if (content?.token) tokens.push(content.token);
        } catch {}
      }
    }
  } catch {}
  return tokens;
}

function getLocalAccountInfo() {
  try {
    const weixinDir = path.join(os.homedir(), ".openclaw", "openclaw-weixin");
    const indexFile = path.join(weixinDir, "accounts.json");
    if (!fs.existsSync(indexFile)) return null;
    const ids = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
    const id = Array.isArray(ids) ? ids[0] : null;
    if (!id) return null;
    const accPath = path.join(weixinDir, "accounts", `${id}.json`);
    if (!fs.existsSync(accPath)) return null;
    const acc = JSON.parse(fs.readFileSync(accPath, "utf-8"));
    return {
      accountId: id,
      userId: acc.userId || null,
      token: acc.token || null,
      baseUrl: acc.baseUrl || ILINK_BASE_URL
    };
  } catch {
    return null;
  }
}

function persistWeixinAccountCredentials(rawBotId, botToken, userId, baseUrl = ILINK_BASE_URL) {
  const normalizedId = rawBotId.trim().toLowerCase().replace(/[@.]/g, "-");
  const weixinDir = path.join(os.homedir(), ".openclaw", "openclaw-weixin");
  const accountsDir = path.join(weixinDir, "accounts");
  fs.mkdirSync(accountsDir, { recursive: true });

  let resolvedUserId = userId?.trim();
  if (!resolvedUserId) {
    try {
      const indexFile = path.join(weixinDir, "accounts.json");
      if (fs.existsSync(indexFile)) {
        const ids = JSON.parse(fs.readFileSync(indexFile, "utf-8"));
        const prevId = Array.isArray(ids) ? ids[0] : null;
        if (prevId) {
          const prevPath = path.join(accountsDir, `${prevId}.json`);
          if (fs.existsSync(prevPath)) {
            resolvedUserId = JSON.parse(fs.readFileSync(prevPath, "utf-8")).userId?.trim();
          }
        }
      }
    } catch {}
  }

  const accountPayload = {
    token: botToken.trim(),
    savedAt: new Date().toISOString(),
    baseUrl,
    ...(resolvedUserId ? { userId: resolvedUserId } : {})
  };
  fs.writeFileSync(path.join(accountsDir, `${normalizedId}.json`), JSON.stringify(accountPayload, null, 2), "utf-8");
  fs.writeFileSync(path.join(weixinDir, "accounts.json"), JSON.stringify([normalizedId], null, 2), "utf-8");
  return normalizedId;
}

export class WechatChannel {
  constructor(tenant) {
    this.tenant = tenant;
    this.botInstance = null;
    this.botAbortController = null;
    this.activeQrSession = null;
    this.activeQrAbortController = null;
    this.chatSessions = new Map();
    this.verifyCodeResolver = null;
    this.syncService = new SyncService(tenant);

    // 从本地凭证恢复账号状态
    const local = getLocalAccountInfo();
    if (local && local.token) {
      this.tenant.wechat.accountId = local.accountId;
      this.tenant.wechat.userId = local.userId;
      this.tenant.wechat.token = local.token;
      this.tenant.wechat.baseUrl = local.baseUrl;
      this.tenant.wechat.connected = true;
      this.tenant.wechat.status = "ONLINE";
    }

    this.tryAutoStart();
  }

  tryAutoStart() {
    if (isLoggedIn() && !this.botInstance) {
      this.startBotRuntime();
    }
  }

  stopBotRuntime() {
    if (this.botAbortController) {
      this.botAbortController.abort();
      this.botAbortController = null;
    }
    this.botInstance = null;
    this.syncService.stopPeriodicPull();
  }

  logoutChannel() {
    this.stopBotRuntime();
    try {
      logout({ log: (m) => this.tenant.addLog("WECHAT", String(m)) });
    } catch (err) {
      this.tenant.addLog("ERROR", `退出微信登录异常: ${err.message}`);
    }
    Object.assign(this.tenant.wechat, {
      connected: false,
      status: "DISCONNECTED",
      accountId: null,
      userId: null,
      token: null,
      qrStatus: "idle",
      errorMessage: "已退出微信登录"
    });
    this.tenant.addLog("WECHAT", "已退出微信登录（本地凭证已清除）");
  }

  saveClassifiedNote(text, categoryId = null, mediaInfo = null) {
    const timeStr = new Date().toLocaleString("zh-CN", { hour12: false });
    const analysis = DualModeRouter.classifyIntent(text, this.tenant.rules, Boolean(mediaInfo));
    const targetRule = (categoryId && this.tenant.rules.find(r => r.id === categoryId)) || analysis.rule;
    const targetPath = path.join(NOTES_SUBDIR, targetRule.fileName);

    try {
      fs.mkdirSync(NOTES_SUBDIR, { recursive: true });
      for (const r of this.tenant.rules) {
        const p = path.join(NOTES_SUBDIR, r.fileName);
        if (!fs.existsSync(p)) {
          fs.writeFileSync(p, `# ${r.title}\n\n> 由 OmniBridge AI 自动归类的「${r.title}」（支持直接问 Siri）\n`, "utf-8");
        }
      }
    } catch (e) {
      this.tenant.addLog("ERROR", `创建 vault 文件失败: ${e.message}`);
    }

    const rawClean = (text || "").replace(/^(记一下|记个|备忘|存档|#记|\/记)[:：\s]*/i, "").trim();
    const cleanText = rawClean === "[图片]" ? "" : rawClean;

    let formattedEntry = "";
    if (targetRule.isTodo) {
      formattedEntry = `\n- [ ] ${cleanText || "[图片待办]"} (${timeStr})\n`;
    } else {
      formattedEntry = `\n### ${timeStr}\n• ${cleanText || "[图片]"}\n`;
    }

    if (mediaInfo) {
      formattedEntry += `- 🖼️ [图库⇄备忘录联动]: 已同步原图至《🖼️ 微信图片速记测试》及 iCloud 云盘/学习照片/${path.basename(mediaInfo.savedPath)}\n`;
    }

    try {
      fs.appendFileSync(targetPath, formattedEntry, "utf-8");
      if (fs.existsSync(INBOX_NOTE_PATH)) {
        const inboxLine = mediaInfo
          ? `\n### ${timeStr} [${targetRule.title}]\n[图片]\n- 🖼️ [图库⇄备忘录联动]: ${path.basename(mediaInfo.savedPath)}\n`
          : `\n### ${timeStr} [${targetRule.title}]\n${cleanText || "[图片]"}\n`;
        fs.appendFileSync(INBOX_NOTE_PATH, inboxLine, "utf-8");
      }
      this.syncService.triggerIcloudPush(2000);
      this.tenant.addLog("CLASSIFY", `✅ 已归类写入《${targetRule.fileName}》 (p=${analysis.probabilities[targetRule.id]})`);
    } catch (e) {
      this.tenant.addLog("ERROR", `写入备忘录失败: ${e.message}`);
    }

    return {
      category: targetRule.id,
      categoryName: targetRule.fileName,
      probabilities: analysis.probabilities,
      siriPrompt: targetRule.siriPrompt,
      cleanText: cleanText || (mediaInfo ? `[图片] ${path.basename(mediaInfo.savedPath)}` : "")
    };
  }

  async handleUnifiedMessage({ conversationId = "default", text = "", media = null }) {
    const startTime = Date.now();
    const trimmed = (text || "").trim();
    const traceSource = conversationId === "siri" ? "siri" : (/^(playground|web)/.test(conversationId) ? "web" : "wechat");
    const trace = TraceBus.start(traceSource, trimmed || (media ? `[媒体] ${media.fileName || ""}` : ""));

    // 1. 快速查询指令: /查, /搜
    if (trimmed.startsWith("/查 ") || trimmed.startsWith("/搜 ")) {
      const kw = trimmed.slice(3).trim();
      trace.step("router", `指令快速检索: 「${kw}」`);
      const hits = searchNotes(kw, 5);
      trace.step("notes", `在备忘录中找到 ${hits.length} 条记录`);
      trace.step("wechat_push", "反馈查询结果");
      trace.done("检索完成");
      const reply = hits.length === 0
        ? `🔍 未找到包含「${kw}」的备忘录。`
        : `🔍 找到包含「${kw}」的备忘录：\n` + hits.map((r, i) => `\n${i + 1}. 📄【${r.title}】\n   "${r.snippet}"`).join("");
      const latencyMs = Date.now() - startTime;
      this.tenant.lastClassification = {
        text: trimmed,
        category: "search",
        categoryName: "🔍 备忘录快速检索",
        probabilities: { key: 0.25, todo: 0.25, link: 0.25, idea: 0.25 },
        modeUsed: "FAST_SEARCH",
        agentReply: reply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };
      return { reply, modeUsed: "FAST_SEARCH", classification: this.tenant.lastClassification };
    }

    // 2. 模式切换与查询指令
    if (/^(\/mode\s+agent_first|ai模式|助手模式|切换ai|切换助手|开启ai|开ai|纯ai模式|纯ai|全能助手|只聊天|只回答)$/i.test(trimmed) || /(切换|开启|锁定).*(ai模式|助手模式)/i.test(trimmed)) {
      this.tenant.wechat.mode = "AGENT_FIRST";
      this.tenant.addLog("MODE", `切换运行模式为: ${this.tenant.wechat.mode}`);
      const reply = `🤖 **已切换为【模式二：纯 AI 助手模式 (AGENT_FIRST)】**\n\n现在发给我的所有消息都会由 **AI 助手** 直接回答（支持写代码、解答问题、检索备忘录、提取 iCloud 云盘简历/文件），不会自动写入备忘录。\n\n💡 *想存备忘录直接对我说「记一下 ...」即可；发送「存档模式」或「双模」可随时切换。*`;
      const latencyMs = Date.now() - startTime;
      this.tenant.lastClassification = {
        text: trimmed,
        category: "system",
        categoryName: "⚙️ 模式切换: AGENT_FIRST",
        probabilities: { key: 0.25, todo: 0.25, link: 0.25, idea: 0.25 },
        modeUsed: "SYSTEM",
        agentReply: reply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };
      return { reply, modeUsed: "SYSTEM", classification: this.tenant.lastClassification };
    }

    if (/^(\/mode\s+notes_first|存档模式|备忘录模式|收集模式|切换存档|切换备忘录|纯存档模式|纯存档|纯备忘录|只记笔记|只存备忘录)$/i.test(trimmed) || /(切换|开启|锁定).*(存档模式|备忘录模式)/i.test(trimmed)) {
      this.tenant.wechat.mode = "NOTES_FIRST";
      this.tenant.addLog("MODE", `切换运行模式为: ${this.tenant.wechat.mode}`);
      const reply = `📥 **已切换为【模式一：纯信息存档模式 (NOTES_FIRST)】**\n\n现在随手发来的所有文字、账号密码、取件码、网页链接和图片，都会 100% 自动分类归档进 **iPhone 备忘录** 并同步至 iCloud！\n\n💡 *发送「AI模式」可切换为 AI 助手，发送「双模」恢复智能自动分流。*`;
      const latencyMs = Date.now() - startTime;
      this.tenant.lastClassification = {
        text: trimmed,
        category: "system",
        categoryName: "⚙️ 模式切换: NOTES_FIRST",
        probabilities: { key: 0.25, todo: 0.25, link: 0.25, idea: 0.25 },
        modeUsed: "SYSTEM",
        agentReply: reply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };
      return { reply, modeUsed: "SYSTEM", classification: this.tenant.lastClassification };
    }

    if (/^(\/mode\s+dual_auto|双模|双模式|智能模式|自动模式|智能双模|切换双模|恢复双模|开启双模)$/i.test(trimmed) || /(切换|恢复|开启).*(双模|智能模式)/i.test(trimmed)) {
      this.tenant.wechat.mode = "DUAL_AUTO";
      this.tenant.addLog("MODE", `切换运行模式为: ${this.tenant.wechat.mode}`);
      const reply = `⚡ **已切换为【智能双模自动分流 (DUAL_AUTO)】**\n\n• **提问 / 写代码 / 查备忘录 / 提云盘文件** ➔ 自动唤醒 **🤖 AI 助手** 回答；\n• **随手丢账号密码 / 待办取件码 / 链接 / 图片** ➔ 自动归类存入 **📥 iPhone 备忘录**！\n\n💡 *随时发送「AI模式」或「存档模式」可手动锁定单一模式。*`;
      const latencyMs = Date.now() - startTime;
      this.tenant.lastClassification = {
        text: trimmed,
        category: "system",
        categoryName: "⚙️ 模式切换: DUAL_AUTO",
        probabilities: { key: 0.25, todo: 0.25, link: 0.25, idea: 0.25 },
        modeUsed: "SYSTEM",
        agentReply: reply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };
      return { reply, modeUsed: "SYSTEM", classification: this.tenant.lastClassification };
    }

    if (/^(\/mode|模式|当前模式|什么模式|查看模式|怎么切换|帮助|\/help|功能|菜单)$/i.test(trimmed) || /(当前|现在).*(是什么模式|处在什么模式)/.test(trimmed)) {
      const reply =
        `🎛️ **OmniBridge AI 双模式控制台**\n` +
        `当前所处模式：**${this.tenant.wechat.mode}**\n\n` +
        `可以在微信直接发送以下口令切换：\n` +
        `• 发送 **「AI模式」** ➔ 锁定 🤖 全能 AI 助手模式（所有消息走 AI 问答，对我说「记一下...」自动保存备忘录）\n` +
        `• 发送 **「存档模式」** ➔ 锁定 📥 信息存档管家模式（所有消息 100% 自动归入 iPhone 备忘录）\n` +
        `• 发送 **「双模」** ➔ 开启 ⚡ 智能双模自动分流（提问走 AI，记事走备忘录）\n` +
        `• 单次强制指令：以 \`/ai \` 开头强制走 AI 问答；以 \`记一下 \` 开头强制存入备忘录。`;
      const latencyMs = Date.now() - startTime;
      this.tenant.lastClassification = {
        text: trimmed,
        category: "system",
        categoryName: "⚙️ 系统菜单与帮助",
        probabilities: { key: 0.25, todo: 0.25, link: 0.25, idea: 0.25 },
        modeUsed: "SYSTEM",
        agentReply: reply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };
      return { reply, modeUsed: "SYSTEM", classification: this.tenant.lastClassification };
    }

    // 3. 媒体处理（微信发图直通 iCloud 云盘 + 备忘录原生嵌图 + 视觉索引）
    let mediaInfo = null;
    let cloudBridgeInfo = null;
    if (media && media.filePath && fs.existsSync(media.filePath)) {
      const rawBuf = fs.readFileSync(media.filePath);
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const isImg = media.type === "image" || (rawBuf[0] === 0xff && rawBuf[1] === 0xd8) || (rawBuf[0] === 0x89 && rawBuf[1] === 0x50);
      let newFileName;
      if (isImg) {
        const norm = normalizeImageFileName(`IMG_${timestamp}`, rawBuf);
        newFileName = norm.fileName;
      } else {
        const ext = path.extname(media.fileName || media.filePath) || ".bin";
        const baseClean = (media.fileName || "wechat_file").replace(/\.[^.]+$/, "");
        newFileName = `${timestamp}_${baseClean}${ext.startsWith(".") ? ext : "." + ext}`;
      }
      const destPath = path.join(MEDIA_SAVE_DIR, newFileName);
      fs.writeFileSync(destPath, rawBuf);
      mediaInfo = { savedPath: destPath, type: isImg ? "image" : media.type, fileName: newFileName };

      let photoSemantic = null;
      if (isImg) {
        try {
          cloudBridgeInfo = await NotesService.bridgeImageToDriveAndNotes(rawBuf, newFileName, trimmed || "微信随手拍直传");
        } catch (e) {
          this.tenant.addLog("WARN", `图片直传 iCloud 云盘/备忘录异常: ${e.message}`);
        }
        try {
          photoSemantic = await analyzeAndIndexNewPhoto(rawBuf, newFileName, trimmed);
          this.tenant.addLog("PHOTO-INDEX", `已完成图片视觉语义索引《${newFileName}》: [${photoSemantic.category}] ${(photoSemantic.tags || []).slice(0, 5).join("/")}`);
        } catch {}
      } else {
        try {
          const driveRes = await DriveService.uploadFile(rawBuf, newFileName, media.mimeType || "application/octet-stream");
          cloudBridgeInfo = { driveRes };
        } catch (e) {
          this.tenant.addLog("WARN", `文件直传 iCloud 云盘异常: ${e.message}`);
        }
      }
    }

    const intent = DualModeRouter.classifyIntent(trimmed, this.tenant.rules, Boolean(mediaInfo));

    const shouldRunAgent =
      !mediaInfo &&
      (this.tenant.wechat.mode === "AGENT_FIRST" ||
        (this.tenant.wechat.mode === "DUAL_AUTO" && intent.isQuestionOrChat) ||
        trimmed.startsWith("/ai "));

    trace.step("router", `智能分流判定: ${shouldRunAgent ? "🤖 AI问答Agent" : "📥 备忘录归档"} (${intent.categoryName || intent.topCategory})`);

    if (shouldRunAgent) {
      const queryText = trimmed.replace(/^\/ai\s+/i, "");
      this.tenant.addLog("AI-AGENT", `识别为【问答/Agent 指令】: "${queryText.slice(0, 50)}"`);
      const history = this.chatSessions.get(conversationId) || [];
      const { replyText: rawAgentReply, outboundMedia } = await AgentService.runConversationalAgent({
        tenant: this.tenant,
        conversationId,
        userText: queryText,
        history,
        saveNoteFn: (content, category) => this.saveClassifiedNote(content, category)
      });

      if (outboundMedia) {
        trace.step("drive", `调取 iCloud 云盘/相册: 《${outboundMedia.fileName}》`);
      } else if (/(相册|照片|图库|视觉)/.test(queryText)) {
        trace.step("photo", "相册视觉语义与 OCR 检索");
      } else {
        trace.step("magpie", "调用 Magpie 本地网关 (DeepSeek-v4.1-flash 1M上下文)");
      }
      trace.step("wechat_push", "推送响应至微信客户端");
      trace.done(`AI Agent 问答完成 (${Date.now() - startTime}ms)`);

      const agentReply = `${rawAgentReply}\n\n——\n⚙️ 运行状态：🤖 AI 助手响应 (${this.tenant.wechat.mode}) | 发「存档模式」只记笔记，发「双模」自动分流`;
      history.push({ role: "user", content: queryText }, { role: "assistant", content: rawAgentReply });
      this.chatSessions.set(conversationId, history.slice(-12));

      const latencyMs = Date.now() - startTime;
      this.tenant.lastClassification = {
        text: queryText,
        category: intent.topCategory || "ai_agent",
        categoryName: outboundMedia ? `📂 iCloud 相册/云盘提取 (${outboundMedia.fileName})` : "🤖 AI Agent 问答对话",
        probabilities: intent.probabilities,
        modeUsed: "AI_AGENT_QA",
        agentReply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };

      return { reply: agentReply, outboundMedia, modeUsed: "AI_AGENT_QA", classification: this.tenant.lastClassification };
    } else {
      const saved = this.saveClassifiedNote(trimmed, intent.topCategory, mediaInfo);
      trace.step("notes", `写入《${saved.categoryName}》并触发 iCloud Push`);
      if (mediaInfo) {
        trace.step("photo", `相册视觉索引已生成: ${mediaInfo.fileName}`);
      }
      trace.step("wechat_push", "推送归档卡片至手机微信");
      trace.done(`备忘录归档完成 (${Date.now() - startTime}ms)`);
      const latencyMs = Date.now() - startTime;
      const indexedMeta = mediaInfo ? getAllIndexedPhotos().find(p => p.fileName === mediaInfo.fileName) : null;
      const semanticNotice = indexedMeta
        ? `\n🔍 [AI 视觉索引已生成]：\n  • 类型：${indexedMeta.category}\n  • 搜索词：${(indexedMeta.tags || []).slice(0, 6).join(" / ")}\n  • 随时发「把${(indexedMeta.tags || [])[0] || "最新"}那张图发我」即可调取原图`
        : "";
      const bridgeNotice = cloudBridgeInfo?.noteRes
        ? `\n🖼️ [图库⇄备忘录互通]：\n  1. 已直传 iCloud 云盘《学习照片/${mediaInfo.fileName}》\n  2. 已作为原生大图内嵌至《微信收集箱》与《${saved.categoryName.replace(".md", "")}》${semanticNotice}`
        : semanticNotice;

      const reply =
        `✅ [📥 智能归类 ➔ 《${saved.categoryName.replace(".md", "")}》]\n` +
        `📝 内容：${saved.cleanText || "[微信随手拍]"}${bridgeNotice}\n` +
        `🎙️ 随时对 iPhone 喊：\n${saved.siriPrompt}\n\n` +
        `——\n⚙️ 运行状态：📥 自动存入备忘录 (${this.tenant.wechat.mode}) | 发「AI模式」锁定全能问答，发「双模」自动分流`;

      this.tenant.lastClassification = {
        text: trimmed || (mediaInfo ? `[图片] ${mediaInfo.fileName}` : ""),
        category: saved.category,
        categoryName: saved.categoryName,
        probabilities: saved.probabilities,
        modeUsed: "NOTE_ARCHIVE",
        agentReply: reply,
        latencyMs,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };

      return { reply, modeUsed: "NOTE_ARCHIVE", classification: this.tenant.lastClassification };
    }
  }

  startBotRuntime() {
    try {
      if (!isLoggedIn()) return;
      this.stopBotRuntime();

      const local = getLocalAccountInfo();
      if (local) {
        if (local.accountId) this.tenant.wechat.accountId = local.accountId;
        if (local.userId) this.tenant.wechat.userId = local.userId;
        if (local.token) this.tenant.wechat.token = local.token;
        if (local.baseUrl) this.tenant.wechat.baseUrl = local.baseUrl;
      }

      this.botAbortController = new AbortController();

      this.botInstance = start(
        {
          clearSession: (cid) => {
            this.chatSessions.delete(cid);
          },
          chat: async (req) => {
            const rawUserText = (req.text || "").trim();
            console.log(`[WeChat Inbound] 收到消息: "${rawUserText.slice(0, 50)}"`);
            this.tenant.addLog("INBOUND", `收到微信消息: ${rawUserText.slice(0, 50)}${req.media ? " [含媒体]" : ""}`);

            const result = await this.handleUnifiedMessage({
              conversationId: req.conversationId,
              text: rawUserText,
              media: req.media
            });

            if (result.outboundMedia) {
              return {
                text: result.reply,
                media: result.outboundMedia,
                outputFormat: "markdown"
              };
            }

            return { text: result.reply, outputFormat: "markdown" };
          }
        },
        {
          outputFormat: "markdown",
          abortSignal: this.botAbortController.signal,
          log: (msg) => {
            console.log(`[weixin] ${msg}`);
            if (msg.includes("token stale (errcode -14)")) {
              this.tenant.wechat.connected = false;
              this.tenant.wechat.status = "EXPIRED";
              this.tenant.wechat.errorMessage = "微信 Token 已失效 (-14)，请重新扫码";
              this.tenant.addLog("WARN", "⚠️ 微信登录凭据已过期 (-14)，请重新扫码绑定");
              this.stopBotRuntime();
            } else if (msg.includes("monitor started")) {
              this.tenant.wechat.connected = true;
              this.tenant.wechat.status = "ONLINE";
              this.tenant.wechat.errorMessage = "";
              this.tenant.addLog("SYSTEM", "✅ 微信 ClawBot 实时双向通信引擎已就绪 (支持手机交互与 AI 问答)");
            }
          }
        }
      );

      // 启动从 iPhone 备忘录拉取发件箱与手机短信流转的高频定时同步 (5s)
      this.syncService.startPeriodicPull(
        () => this.botInstance,
        5000,
        () => (text, cat) => this.saveClassifiedNote(text, cat)
      );
    } catch (err) {
      this.tenant.addLog("ERROR", `启动微信 ClawBot 异常: ${err.message}`);
    }
  }

  async createQrSession() {
    if (this.activeQrAbortController) {
      this.activeQrAbortController.abort();
      this.activeQrAbortController = null;
    }

    const resp = await fetch(`${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      method: "POST",
      headers: buildIlinkPostHeaders(),
      body: JSON.stringify({ local_token_list: [] })
    });
    if (!resp.ok) throw new Error(`微信官方网关响应异常 HTTP ${resp.status}`);

    const data = await resp.json();
    if (!data.qrcode_img_content || !data.qrcode) {
      throw new Error("未能获取有效的微信官方扫码凭证");
    }

    const qrDataUrl = await QRCode.toDataURL(data.qrcode_img_content, {
      width: 240,
      margin: 1,
      color: { dark: "#1E1E1E", light: "#FEFEFE" }
    });

    console.log("\n=======================================================");
    console.log("📱 请用手机微信扫描下方二维码完成连接：");
    console.log(`🔗 二维码直链: ${data.qrcode_img_content}`);
    try {
      qrcodeterminal.generate(data.qrcode_img_content, { small: true });
    } catch {}
    console.log("=======================================================\n");

    this.activeQrAbortController = new AbortController();
    this.activeQrSession = {
      qrcode: data.qrcode,
      qrcodeUrl: data.qrcode_img_content,
      qrDataUrl,
      status: "wait",
      createdAt: Date.now()
    };

    this.tenant.wechat.qrStatus = "wait";
    this.tenant.addLog("WECHAT", "已生成微信官方扫码二维码，正在监听手机扫码...");

    this.pollQrStatusLoop(this.activeQrSession, this.activeQrAbortController.signal).catch(err => {
      this.tenant.addLog("WARN", `二维码轮询异常: ${err.message}`);
    });

    return this.activeQrSession;
  }

  async pollQrStatusLoop(session, abortSignal) {
    let currentBaseUrl = ILINK_BASE_URL;
    const deadline = session.createdAt + QR_SESSION_TTL_MS;
    console.log(`[QR Poll] 开始轮询 qrcode=${session.qrcode}`);

    while (Date.now() < deadline && !abortSignal.aborted) {
      const pollController = new AbortController();
      const timeoutId = setTimeout(() => pollController.abort(), QR_LONG_POLL_TIMEOUT_MS);
      const combinedSignal = AbortSignal.any([abortSignal, pollController.signal]);

      try {
        let endpoint = `${currentBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`;
        if (session.pendingVerifyCode) endpoint += `&verify_code=${encodeURIComponent(session.pendingVerifyCode)}`;
        const resp = await fetch(endpoint, {
          method: "GET",
          headers: buildIlinkCommonHeaders(),
          signal: combinedSignal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        const statusData = await resp.json();
        session.status = statusData.status || "wait";
        this.tenant.wechat.qrStatus = session.status;

        if (statusData.status === "scaned") {
          session.pendingVerifyCode = undefined;
          this.tenant.addLog("WECHAT", "📱 手机微信已扫码，请在手机端点击确认授权...");
        } else if (statusData.status === "scaned_but_redirect") {
          if (statusData.redirect_host) {
            currentBaseUrl = `https://${statusData.redirect_host}`;
          }
        } else if (statusData.status === "need_verifycode") {
          this.tenant.addLog("WECHAT", "🔐 需要安全验证：请查看手机微信上的数字验证码并输入");
          const code = await this.waitForVerifyCode(abortSignal);
          if (!code) return;
          session.pendingVerifyCode = code;
          this.tenant.addLog("WECHAT", "已收到验证码，继续验证...");
          continue;
        } else if (statusData.status === "binded_redirect") {
          const localTokens = getLocalStoredTokens();
          if (localTokens.length > 0) {
            this.tenant.wechat.connected = true;
            this.tenant.wechat.status = "ONLINE";
            this.tenant.wechat.errorMessage = "";
            this.tenant.addLog("WECHAT", "✅ 已连接过此 OpenClaw，正在复用本地账号...");
            session.status = "confirmed";
            this.startBotRuntime();
            return;
          }
          this.tenant.addLog("WARN", "已绑定但本地无有效凭证，请重新扫码");
          session.status = "expired";
          this.tenant.wechat.qrStatus = "expired";
          return;
        } else if (statusData.status === "confirmed") {
          if (statusData.ilink_bot_id && statusData.bot_token) {
            const baseUrl = statusData.baseurl || statusData.base_url || currentBaseUrl;
            persistWeixinAccountCredentials(
              statusData.ilink_bot_id,
              statusData.bot_token,
              statusData.ilink_user_id,
              baseUrl
            );
            this.tenant.wechat.accountId = statusData.ilink_bot_id;
            this.tenant.wechat.token = statusData.bot_token;
            this.tenant.wechat.userId = statusData.ilink_user_id || "wechat-user";
            this.tenant.wechat.baseUrl = baseUrl;
            this.tenant.wechat.connected = true;
            this.tenant.wechat.status = "ONLINE";
            this.tenant.wechat.errorMessage = "";
            session.status = "confirmed";
            this.tenant.addLog("WECHAT", `🎉 微信扫码绑定成功！已激活专属通道 (${statusData.ilink_bot_id})`);

            this.startBotRuntime();
            return;
          }
        } else if (statusData.status === "expired") {
          session.status = "expired";
          this.tenant.wechat.qrStatus = "expired";
          this.tenant.addLog("WARN", "⏳ 微信扫码已超时过期，请点击重新生成");
          return;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (abortSignal.aborted) return;
      }
    }
  }

  waitForVerifyCode(abortSignal) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.verifyCodeResolver = null;
        resolve(null);
      }, QR_SESSION_TTL_MS);
      this.verifyCodeResolver = (code) => {
        clearTimeout(timeout);
        resolve(code);
      };
      abortSignal.addEventListener("abort", () => {
        clearTimeout(timeout);
        if (this.verifyCodeResolver) {
          this.verifyCodeResolver = null;
          resolve(null);
        }
      }, { once: true });
    });
  }

  submitVerifyCode(code) {
    const trimmed = String(code || "").trim();
    if (!trimmed || !this.verifyCodeResolver) return false;
    const resolve = this.verifyCodeResolver;
    this.verifyCodeResolver = null;
    resolve(trimmed);
    return true;
  }
}
