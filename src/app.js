import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { tenantManager } from "./core/tenant/TenantManager.js";
import { WechatProbe } from "./channels/wechat/WechatProbe.js";
import { WechatChannel } from "./channels/wechat/WechatChannel.js";
import { IcloudProbe } from "./sinks/icloud/IcloudProbe.js";
import { IcloudAuthManager, ICLOUD_LOGIN_STAGES } from "./sinks/icloud/IcloudAuth.js";
import { NotesService } from "./sinks/icloud/NotesService.js";
import { DriveService } from "./sinks/icloud/DriveService.js";
import { SyncService } from "./sinks/icloud/SyncService.js";
import { DualModeRouter } from "./core/router/DualModeRouter.js";
import { AgentService, searchNotes } from "./core/router/AgentService.js";
import { SmsMonitorService } from "./core/sms/SmsMonitorService.js";
import { TraceBus } from "./core/trace/TraceBus.js";
import { searchPhotosByQuery, getAllIndexedPhotos, analyzeAndIndexNewPhoto } from "./core/photo-index-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PORT_PRIMARY = 3080;
const PORT_SECONDARY = 3090;
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");

const channelInstances = new Map();
const icloudAuthInstances = new Map();

function getWechatChannel(tenant) {
  if (!channelInstances.has(tenant.tenantId)) {
    channelInstances.set(tenant.tenantId, new WechatChannel(tenant));
  }
  return channelInstances.get(tenant.tenantId);
}

function getIcloudAuth(tenant) {
  if (!icloudAuthInstances.has(tenant.tenantId)) {
    icloudAuthInstances.set(tenant.tenantId, new IcloudAuthManager(tenant));
  }
  return icloudAuthInstances.get(tenant.tenantId);
}

// 启动时初始化 default 租户通道，自动连接已登录账号
const defaultTenant = tenantManager.getTenant("default");
const defaultChannel = getWechatChannel(defaultTenant);
const defaultIcloud = getIcloudAuth(defaultTenant);

// 首次异步静默探测 iCloud 会话
defaultIcloud.getLoginSnapshot(NOTES_DIR).catch(() => {});

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); }
    });
  });
}

function readVaultPreview(fileName, maxLines = 6) {
  const filePath = path.join(NOTES_SUBDIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("---"));
    return lines.slice(-maxLines).reverse();
  } catch {
    return [];
  }
}

function buildStatus(tenant) {
  try {
    if (fs.existsSync(NOTES_SUBDIR)) {
      tenant.icloud.noteCount = fs.readdirSync(NOTES_SUBDIR).filter(f => f.endsWith(".md")).length;
    }
    if (fs.existsSync(ATTACHMENTS_DIR)) {
      tenant.icloud.attachmentCount = fs.readdirSync(ATTACHMENTS_DIR).length;
    }
  } catch {}

  const vaults = {};
  for (const r of (tenant.rules || [])) {
    vaults[r.id] = readVaultPreview(r.fileName);
  }

  return {
    wechat: tenant.wechat,
    icloud: tenant.icloud,
    rules: tenant.rules,
    vaults,
    lastClassification: tenant.lastClassification || {},
    logs: tenant.logs.slice(0, 25)
  };
}

async function handleHttpRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tenant-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const tenantId = req.headers["x-tenant-id"] || url.searchParams.get("tenantId") || "default";
  const tenant = tenantManager.getTenant(tenantId);
  const wechatChan = getWechatChannel(tenant);
  const icloudAuth = getIcloudAuth(tenant);

  // 0. API: SSE 实时链路追踪数据流 (Magpie 风格拓扑图与链路日志)
  if (url.pathname === "/api/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write("retry: 3000\n\n");

    // 回放最近事件
    for (const ev of TraceBus.recent.slice(-25)) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }

    // 发送初始统计
    res.write(`data: ${JSON.stringify({ type: "stats", stats: TraceBus.stats })}\n\n`);

    const onTraceEvent = (ev) => {
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {}
    };
    TraceBus.on("event", onTraceEvent);

    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      TraceBus.off("event", onTraceEvent);
    });
    return;
  }

  // 1. API: Real-Time Status Probe
  if (url.pathname === "/api/status" && req.method === "GET") {
    // 微信通道在线状态：以当前活跃的 bot 实例或已保存的凭证为准
    if (wechatChan.botInstance) {
      tenant.wechat.connected = true;
      tenant.wechat.status = "ONLINE";
      tenant.wechat.errorMessage = "";
    } else {
      const wxRes = await WechatProbe.probeSession(tenant.wechat.token, tenant.wechat.baseUrl);
      tenant.wechat.connected = wxRes.alive;
      tenant.wechat.status = wxRes.alive ? "ONLINE" : "DISCONNECTED";
      if (wxRes.alive) {
        if (wxRes.accountId) tenant.wechat.accountId = wxRes.accountId;
        if (wxRes.userId) tenant.wechat.userId = wxRes.userId;
      }
    }

    // iCloud 状态：检查现有 meta 和会话
    const meta = icloudAuth.getExistingMeta(NOTES_DIR);
    if (meta?.appleId) {
      tenant.icloud.appleId = meta.appleId;
      tenant.icloud.dsid = String(meta.dsid);
      const isAlive = await icloudAuth.checkAccountAlive(meta.dsid);
      tenant.icloud.connected = isAlive;
      tenant.icloud.status = isAlive ? "ONLINE" : "EXPIRED";
      tenant.icloud.errorMessage = isAlive ? "" : "iCloud 凭证已过期 (HTTP 421)，请点击重新授权";
    }

    try {
      if (fs.existsSync(NOTES_SUBDIR)) {
        tenant.icloud.noteCount = fs.readdirSync(NOTES_SUBDIR).filter(f => f.endsWith(".md")).length;
      }
      if (fs.existsSync(ATTACHMENTS_DIR)) {
        tenant.icloud.attachmentCount = fs.readdirSync(ATTACHMENTS_DIR).length;
      }
    } catch {}

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      tenantId: tenant.tenantId,
      version: "3.0.0-omnibridge-bus",
      ...buildStatus(tenant)
    }));
  }

  // 2. API: 申请微信官方二维码
  if (url.pathname === "/api/wechat/qr" && req.method === "POST") {
    try {
      const qr = await wechatChan.createQrSession();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, qrDataUrl: qr.qrDataUrl, qrcodeUrl: qr.qrcodeUrl }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 2.5. API: 微信退出登录
  if (url.pathname === "/api/wechat/logout" && req.method === "POST") {
    wechatChan.logoutChannel();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, wechat: tenant.wechat }));
  }

  // 2.6. API: 提交微信安全验证码
  if (url.pathname === "/api/wechat/verify" && req.method === "POST") {
    const body = await readJsonBody(req);
    const ok = wechatChan.submitVerifyCode(body.code);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok, message: ok ? "验证码已提交" : "当前无需验证码或已超时" }));
  }

  // 3. API: 触发 iCloud 授权登录
  if (url.pathname === "/api/icloud/relogin" && req.method === "POST") {
    icloudAuth.startLogin(NOTES_DIR).catch(err => {
      console.error("[iCloud Relogin Error]", err);
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, icloud: { ...icloudAuth.state } }));
  }

  // 4. API: 轮询 iCloud 登录进展
  if (url.pathname === "/api/icloud/login/status" && req.method === "GET") {
    const snapshot = await icloudAuth.getLoginSnapshot(NOTES_DIR);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, icloud: snapshot }));
  }

  // 5. API: 双模切换
  if (url.pathname === "/api/mode" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (["DUAL_AUTO", "AGENT_FIRST", "NOTES_FIRST"].includes(body.mode)) {
      tenant.wechat.mode = body.mode;
      tenant.addLog("MODE", `切换分流模式为: ${tenant.wechat.mode}`);
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, mode: tenant.wechat.mode, status: buildStatus(tenant) }));
  }

  // 5.5. API: 手机短信即时 Webhook 极速流入接口 (< 500ms 极速推微信 & 归档备忘录)
  if (url.pathname === "/api/sms/inbound" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const rawText = (body.text || body.content || body.message || "").trim();
      const sender = (body.sender || body.from || "").trim();
      if (!rawText) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: "短信内容不能为空" }));
      }

      const result = await SmsMonitorService.processInboundSmsDirectly({
        text: rawText,
        sender,
        tenant,
        botInstance: wechatChan.botInstance,
        saveNoteFn: (content, cat) => wechatChan.saveClassifiedNote(content, cat),
        triggerPushFn: (delay) => wechatChan.syncService.triggerIcloudPush(delay)
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, result, status: buildStatus(tenant) }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 6. API: Playground 真实执行测试 (支持自动分流、AI Agent问答、相册搜图、云盘提取及推送到手机微信)
  if (url.pathname === "/api/simulate" && req.method === "POST") {
    const t0 = Date.now();
    const body = await readJsonBody(req);
    const inputText = (body.text || "").trim();
    const pushToPhone = Boolean(body.pushToPhone);

    if (!inputText) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: "内容不能为空" }));
    }

    const result = await wechatChan.handleUnifiedMessage({
      conversationId: "playground-operator",
      text: inputText
    });

    let pushedToWechat = false;
    if (wechatChan.botInstance && (pushToPhone || result.outboundMedia)) {
      try {
        if (result.outboundMedia) {
          await wechatChan.botInstance.sendMessage({
            text: `🖥️ [来自 OmniBridge 控制台提取]\n${result.reply}`,
            media: result.outboundMedia
          });
        } else {
          await wechatChan.botInstance.sendMessage(`🖥️ [来自 OmniBridge 控制台测试]\n你的输入：${inputText}\n\n${result.reply}`);
        }
        pushedToWechat = true;
        tenant.addLog("WECHAT", `已将控制台执行结果真实推送到手机微信${result.outboundMedia ? ` (含附件: ${result.outboundMedia.fileName})` : ""}`);
      } catch (e) {
        tenant.addLog("WARN", `推送手机微信失败: ${e.message}`);
      }
    }

    const latencyMs = Date.now() - t0;
    if (tenant.lastClassification) {
      tenant.lastClassification.latencyMs = latencyMs;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      pushedToWechat,
      result,
      status: buildStatus(tenant)
    }));
  }

  // 6.5. API: 网页端实时对话 / 测试 (Playground 交互控制台)
  if (url.pathname === "/api/message" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const text = (body.text || "").trim();
      if (!text) throw new Error("消息内容不能为空");

      const result = await wechatChan.handleUnifiedMessage({
        conversationId: "web-console",
        text
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true,
        reply: result.reply,
        outboundMedia: result.outboundMedia,
        modeUsed: result.modeUsed,
        status: buildStatus(tenant)
      }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 7. API: 备忘录搜索
  if (url.pathname === "/api/notes/search" && req.method === "POST") {
    const body = await readJsonBody(req);
    const query = (body.query || "").trim();
    const hits = searchNotes(query, 6);
    tenant.addLog("SEARCH", `检索备忘录: "${query}" (命中 ${hits.length} 条)`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, query, hits }));
  }

  // 8. API: 手动双向同步 iCloud
  if (url.pathname === "/api/icloud/sync" && req.method === "POST") {
    tenant.addLog("ICLOUD", "手动触发 iCloud 双向同步 (Push & Pull)...");
    const pushRes = await wechatChan.syncService.executeIcloudPush();
    await wechatChan.syncService.checkOutboxAndPull(
      wechatChan.botInstance,
      (text, cat) => wechatChan.saveClassifiedNote(text, cat)
    );
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      push: pushRes,
      message: "iCloud 双向同步完成",
      status: buildStatus(tenant)
    }));
  }

  // 9. API: 分类本规则管理
  if (url.pathname === "/api/vaults/rules" && req.method === "POST") {
    const body = await readJsonBody(req);
    const title = (body.title || "").trim();
    const rawKeywords = (body.keywords || "").trim();
    if (!title || !rawKeywords) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: "分类名称和关键词不能为空" }));
    }
    const id = "custom_" + Date.now().toString(36);
    const keywords = rawKeywords.split(/[,，\s]+/).map(k => k.trim()).filter(Boolean);
    const newRule = {
      id,
      title: title.replace(/\.md$/, ""),
      fileName: title.endsWith(".md") ? title : `${title}.md`,
      keywords,
      siriPrompt: `“嘿 Siri，查一下我备忘录里的 ${title.replace(/\.md$/, "")}”`,
      isTodo: Boolean(body.isTodo)
    };
    tenant.rules.push(newRule);
    tenant.addLog("RULE", `新增分类规则: 《${newRule.fileName}》`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, rule: newRule, status: buildStatus(tenant) }));
  }

  if (url.pathname === "/api/vaults/rules" && req.method === "DELETE") {
    const body = await readJsonBody(req);
    tenant.rules = tenant.rules.filter(r => r.id !== body.id);
    tenant.addLog("RULE", `删除分类规则 ID: ${body.id}`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, status: buildStatus(tenant) }));
  }

  // 10. API: iCloud Drive 实时文件列表
  if (url.pathname === "/api/icloud/drive" && req.method === "GET") {
    try {
      const forceRefresh = url.searchParams.get("refresh") === "1";
      const listing = await DriveService.listDriveItems(forceRefresh);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true,
        account: listing.account,
        folders: listing.folders,
        files: listing.files,
        noteImages: listing.noteImages
      }));
    } catch (e) {
      // 优雅降级返回本地备忘录
      const files = [];
      if (fs.existsSync(NOTES_SUBDIR)) {
        const list = fs.readdirSync(NOTES_SUBDIR);
        for (const f of list.slice(0, 20)) {
          if (f.endsWith(".md")) {
            const st = fs.statSync(path.join(NOTES_SUBDIR, f));
            files.push({ name: f, size: st.size, folderName: "Notes", docwsid: "local::" + f });
          }
        }
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true,
        account: { appleId: tenant.icloud.appleId || "iCloud 用户", fullName: "Apple Notes Vault" },
        folders: [{ name: "Notes 备忘录" }, { name: "学习照片" }],
        files,
        noteImages: getAllIndexedPhotos().slice(0, 10)
      }));
    }
  }

  // 10.3. API: 发送 iCloud 云盘文件 / 备忘录图片到手机微信
  if (url.pathname === "/api/icloud/drive/send-to-wechat" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      let mediaPayload = null;
      let label = "";

      if (body.noteImageName) {
        const localPath = path.join(ATTACHMENTS_DIR, path.basename(body.noteImageName));
        if (!fs.existsSync(localPath)) throw new Error("本地图库附件不存在");
        mediaPayload = { type: "image", url: localPath, fileName: path.basename(localPath) };
        label = `🖼️ [来自你的 iPhone 备忘录图库]\n图片：${path.basename(localPath)}`;
      } else if (body.docwsid) {
        const dl = await DriveService.downloadFile(body.docwsid, body.fileName || "icloud_file.pdf");
        const isImg = /\.(png|jpe?g|gif|webp)$/i.test(dl.fileName);
        mediaPayload = { type: isImg ? "image" : "file", url: dl.localPath, fileName: dl.fileName };
        label = `📂 [来自你的 iCloud 云盘]\n文件：${dl.fileName} (${(dl.size / 1024).toFixed(1)} KB)`;
      } else {
        throw new Error("缺少 docwsid 或 noteImageName 参数");
      }

      if (!wechatChan.botInstance) throw new Error("微信 bot 未在线，请先完成微信扫码登录");
      await wechatChan.botInstance.sendMessage({ text: label, media: mediaPayload });
      tenant.addLog("WECHAT", `✅ 已发送文件/图片《${mediaPayload.fileName}》至手机微信`);

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, sentFile: mediaPayload.fileName, status: buildStatus(tenant) }));
    } catch (e) {
      tenant.addLog("ERROR", `发送文件至微信失败: ${e.message}`);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 10.4. API: 图库 ⇄ 备忘录双向直传桥接
  if (url.pathname === "/api/icloud/photo-bridge" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const caption = (body.caption || "微信视觉速记直传").trim();
      const rawFileName = (body.fileName || `NoteBridge_${Date.now().toString().slice(-5)}.png`).replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, "_");
      const fileName = /\.(png|jpe?g)$/i.test(rawFileName) ? rawFileName : `${rawFileName}.png`;

      let imgBuffer;
      if (body.dataUrl && body.dataUrl.includes("base64,")) {
        imgBuffer = Buffer.from(body.dataUrl.split("base64,")[1], "base64");
      } else {
        imgBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      }

      // 直传 iCloud 云盘 + Apple 备忘录
      const bridgeResult = await NotesService.bridgeImageToDriveAndNotes(imgBuffer, fileName, caption);

      // AI 视觉标签 + OCR 索引
      let photoSemantic = null;
      try { photoSemantic = await analyzeAndIndexNewPhoto(imgBuffer, fileName, caption); } catch {}

      // 推送到微信
      if (body.pushToPhone && wechatChan.botInstance) {
        await wechatChan.botInstance.sendMessage(
          `🖼️ [图库⇄备忘录联动完成]\n1️⃣ 已直传 iCloud 云盘：${fileName}\n2️⃣ AI 视觉标签：[${photoSemantic?.category || "图片"}] ${(photoSemantic?.tags || []).slice(0, 5).join(" / ")}`
        );
      }

      tenant.addLog("PHOTO-BRIDGE", `图片桥接完成: ${fileName}`);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true,
        fileName,
        caption,
        photoSemantic,
        bridgeResult,
        status: buildStatus(tenant)
      }));
    } catch (e) {
      tenant.addLog("ERROR", `图库⇄备忘录直传失败: ${e.message}`);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 10.5. API: 多维语义与 OCR 批量搜图
  if (url.pathname === "/api/photos/search" && req.method === "POST") {
    const body = await readJsonBody(req);
    const kw = (body.query || "").trim();
    const searchRes = kw ? searchPhotosByQuery(kw) : { matches: getAllIndexedPhotos() };
    const hits = Array.isArray(searchRes.matches) ? searchRes.matches : [];
    tenant.addLog("PHOTO-SEARCH", `检索图库: "${kw || "全部"}" (命中 ${hits.length} 张)`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, query: kw, hits }));
  }

  // 10.6. 静态图片附件预览: /attachments/<fileName>
  if (url.pathname.startsWith("/attachments/") && req.method === "GET") {
    const fname = decodeURIComponent(url.pathname.replace("/attachments/", ""));
    const fpath = path.join(ATTACHMENTS_DIR, path.basename(fname));
    if (fs.existsSync(fpath)) {
      const ext = path.extname(fpath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
      res.writeHead(200, { "Content-Type": mime });
      return res.end(fs.readFileSync(fpath));
    }
  }

  // 11. 静态前端资源文件
  let reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(PUBLIC_DIR, reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found - OmniBridge Core");
}

process.on("uncaughtException", (err) => {
  console.error("💥 [Uncaught Exception]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("💥 [Unhandled Rejection]", reason);
});

const server3080 = http.createServer(handleHttpRequest);
const server3090 = http.createServer(handleHttpRequest);

server3080.listen(PORT_PRIMARY, () => {
  console.log(`📡 OmniBridge Core 监听主端口: http://localhost:${PORT_PRIMARY}`);
});

server3090.listen(PORT_SECONDARY, () => {
  console.log(`📡 OmniBridge Core 监听辅助端口: http://localhost:${PORT_SECONDARY}`);
  console.log(`\n======================================================`);
  console.log(`🚀 OmniBridge Core (v3.0.0 全功能智能数据总线) 已启动`);
  console.log(`🔗 浏览器打开: http://localhost:3080 或 http://localhost:3090`);
  console.log(`======================================================\n`);
});
