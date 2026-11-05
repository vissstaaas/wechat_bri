import { start, isLoggedIn } from "weixin-agent-sdk";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { exec, spawn } from "child_process";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import { create, clone } from "@bufbuild/protobuf";
import { loadSession } from "./node_modules/icloud-md/dist/session.js";
import { listAccounts, accountSessionPath } from "./node_modules/icloud-md/dist/auth/accountStore.js";
import { lookupRecords } from "./node_modules/icloud-md/dist/cloudkit/databaseClient.js";
import { parseNoteDocument, buildInitialNoteDocument, applyTextEdit, encodeNoteDocument } from "./node_modules/icloud-md/dist/notes/noteDocument.js";
import { decompressNoteDocument, compressNoteDocument } from "./node_modules/icloud-md/dist/notes/noteText.js";
import { buildNoteCreateFields, buildNoteUpdateFields } from "./node_modules/icloud-md/dist/notes/encodeNoteRecord.js";
import { AttributeRunSchema, AttachmentInfoSchema } from "./node_modules/icloud-md/dist/notes/gen/topotext_pb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3080;
const PUBLIC_DIR = path.join(__dirname, "public");
const NOTES_DIR = path.join(__dirname, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");
const MEDIA_SAVE_DIR = path.join(__dirname, "wechat_media");
const RULES_FILE = path.join(__dirname, "vault-rules.json");
const CLI_PATH = path.join(__dirname, "node_modules", "icloud-md", "dist", "cli.js");

if (!fs.existsSync(MEDIA_SAVE_DIR)) fs.mkdirSync(MEDIA_SAVE_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(NOTES_SUBDIR)) fs.mkdirSync(NOTES_SUBDIR, { recursive: true });

const INBOX_NOTE_PATH = path.join(NOTES_SUBDIR, "微信收集箱.md");
const OUTBOX_NOTE_PATH = path.join(NOTES_SUBDIR, "发往微信.md");

const OUTBOX_HEADER = `发往微信

> 在本条备忘录末尾写入的内容，会自动发送到你的微信助手。
`;

// ============================================================================
// 1. 动态可配置的备忘录分类规则引擎 (支持后台自定义新增/删除分类本)
// ============================================================================
const DEFAULT_VAULT_RULES = [
  {
    id: "key",
    title: "🔑 账号与重要速查",
    fileName: "🔑 账号与重要速查.md",
    keywords: ["密码", "账号", "户号", "卡号", "身份证", "密钥", "token", "key", "pin", "验证码", "报名", "学号", "工号", "wifi"],
    siriPrompt: "“嘿 Siri，查一下我备忘录里的账号密码”",
    isTodo: false,
    builtIn: true
  },
  {
    id: "todo",
    title: "☑️ 待办与取件码",
    fileName: "☑️ 待办与取件码.md",
    keywords: ["明天", "后天", "下午", "上午", "晚上", "点半", "点去", "周一", "周二", "周三", "周四", "周五", "周末", "取件码", "快递", "丰巢", "菜鸟", "买", "交", "记得", "待办", "todo", "提醒", "开会", "ddl"],
    siriPrompt: "“嘿 Siri，我备忘录里有什么待办和取件码？”",
    isTodo: true,
    builtIn: true
  },
  {
    id: "link",
    title: "🔗 链接与稍后读",
    fileName: "🔗 链接与稍后读.md",
    keywords: ["http://", "https://", "www.", "github.com", ".com/", ".cn/", "文章", "链接", "稍后读", "开源"],
    siriPrompt: "“嘿 Siri，我备忘录里存了什么网页链接？”",
    isTodo: false,
    builtIn: true
  },
  {
    id: "idea",
    title: "💡 灵感与随手记",
    fileName: "💡 灵感与随手记.md",
    keywords: ["灵感", "想法", "随笔", "摘录", "总结", "笔记"],
    siriPrompt: "“嘿 Siri，念一下我备忘录里最新记的灵感”",
    isTodo: false,
    builtIn: true
  }
];

function loadVaultRules() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RULES_FILE, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  fs.writeFileSync(RULES_FILE, JSON.stringify(DEFAULT_VAULT_RULES, null, 2), "utf-8");
  return DEFAULT_VAULT_RULES;
}

function saveVaultRules(rules) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf-8");
  ensureAllVaultFiles(rules);
}

function ensureAllVaultFiles(rules) {
  for (const r of rules) {
    const fp = path.join(NOTES_SUBDIR, r.fileName);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(
        fp,
        `${r.title}\n\n> 由 NoteBridge AI 自动归类的备忘录（匹配词：${r.keywords.slice(0, 6).join("、")} · 支持随时唤醒 Siri 查询）\n\n`,
        "utf-8"
      );
    }
  }
}

let vaultRules = loadVaultRules();
ensureAllVaultFiles(vaultRules);

// 全局状态
let botInstance = null;
let currentMode = "DUAL_AUTO"; // DUAL_AUTO | AGENT_FIRST | NOTES_FIRST
let lastSyncTime = new Date().toLocaleTimeString("zh-CN", { hour12: false });
let isPushing = false;
let pendingPush = false;
let isPulling = false;
let pushTimer = null;
const chatSessions = new Map();

const activityLogs = [];
function addLog(tag, message) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  activityLogs.unshift({ time, tag, message });
  if (activityLogs.length > 50) activityLogs.pop();
  console.log(`[${time}] [${tag}] ${message}`);
}

let lastClassification = {
  text: "英语报名账号 19971518837 密码 Study2026",
  category: "key",
  categoryName: "🔑 账号与重要速查.md",
  probabilities: { key: 0.98, todo: 0.01, link: 0.01, idea: 0.00 },
  modeUsed: "NOTE_ARCHIVE",
  agentReply: "✅ 已自动归入《🔑 账号与重要速查》并同步至 iPhone 备忘录",
  siriQuery: "“嘿 Siri，查一下我备忘录里的英语账号密码”",
  siriAnswer: "在你的备忘录《🔑 账号与重要速查》中找到：\n• 英语报名账号 19971518837 密码 Study2026",
  latencyMs: 54,
  timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
};

// ============================================================================
// 2. iCloud 备忘录同步引擎 (Push / Pull)
// ============================================================================
function triggerIcloudPush(delayMs = 2000) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    executeIcloudPush();
  }, delayMs);
}

function executeIcloudPush() {
  return new Promise((resolve) => {
    if (isPushing) {
      pendingPush = true;
      return resolve({ ok: true, queued: true });
    }
    isPushing = true;
    addLog("ICLOUD", "正在推送本地分类备忘录至 iCloud 云上贵州...");

    exec(`node "${CLI_PATH}" push`, { cwd: NOTES_DIR }, (err, stdout, stderr) => {
      isPushing = false;
      lastSyncTime = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      if (err) {
        addLog("WARN", `iCloud Push 警告: ${(err.message || stderr).slice(0, 120)}`);
        resolve({ ok: false, error: err.message || stderr });
      } else {
        addLog("ICLOUD", "✅ iCloud 推送完成，iPhone 备忘录与 Siri 索引已更新");
        resolve({ ok: true, output: stdout });
      }
      if (pendingPush) {
        pendingPush = false;
        executeIcloudPush();
      }
    });
  });
}

function checkOutboxAndPull(bot) {
  return new Promise((resolve) => {
    if (isPulling || isPushing) return resolve({ skipped: true });
    isPulling = true;

    exec(`node "${CLI_PATH}" pull`, { cwd: NOTES_DIR }, async (err) => {
      isPulling = false;
      lastSyncTime = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      if (err) return resolve({ ok: false, error: err.message });

      try {
        if (!fs.existsSync(OUTBOX_NOTE_PATH)) return resolve({ ok: true });
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
          if (userText.length > 0 && bot) {
            addLog("OUTBOX", `检测到 iPhone《发往微信》新内容: ${userText.slice(0, 60)}`);

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
                await bot.sendMessage({
                  text: caption,
                  media: { type: "image", url: imgPath }
                });
                addLog("WECHAT", `已将备忘录图片发送至手机微信: ${path.basename(imgPath)}`);
              }
            } else if (cleanText) {
              await bot.sendMessage(`📱 [来自 iPhone 备忘录]\n${cleanText}`);
              addLog("WECHAT", `已将备忘录文本发送至手机微信: ${cleanText.slice(0, 40)}`);
            }

            const newContent = content.slice(0, content.indexOf(body)) + OUTBOX_HEADER;
            fs.writeFileSync(OUTBOX_NOTE_PATH, newContent, "utf-8");
            triggerIcloudPush(1000);
          }
        }
        resolve({ ok: true });
      } catch (e) {
        addLog("ERROR", `检查发件箱异常: ${e.message}`);
        resolve({ ok: false, error: e.message });
      }
    });
  });
}

// ============================================================================
// 2.5 iCloud 云盘 (Drive) & 备忘录原生图库直嵌引擎 (p211-*.icloud.com.cn)
// ============================================================================
let cachedIcloudWs = null;
let cachedIcloudWsAt = 0;
let cachedDriveListing = null;
let cachedDriveListingAt = 0;

// 专属原生图文备忘录 RecordName (已通过 CloudKit 实网验证)
const GALLERY_NOTE_RECORD_NAME = "5439C17F-DBB2-4571-BCA1-B52D139F19C0";
const DRIVE_PHOTO_FOLDER_ID = "C71D98D3-A6C1-41BC-B530-8250CB864A2C"; // 学习照片

async function getIcloudWebservices(forceRefresh = false) {
  if (!forceRefresh && cachedIcloudWs && Date.now() - cachedIcloudWsAt < 10 * 60 * 1000) {
    return cachedIcloudWs;
  }
  const accs = await listAccounts();
  if (!accs || accs.length === 0) throw new Error("未找到已登录的 iCloud 账号会话");
  const session = await loadSession(accountSessionPath(accs[0].dsid));
  const res = await fetch(
    "https://setup.icloud.com.cn/setup/ws/1/validate?clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a",
    {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: session.cookie
      }
    }
  );
  if (!res.ok) throw new Error(`iCloud validate HTTP ${res.status}`);
  const data = await res.json();
  cachedIcloudWs = {
    session,
    dsid: String(data.dsInfo?.dsid || accs[0].dsid),
    fullName: data.dsInfo?.fullName || "iCloud User",
    appleId: data.dsInfo?.appleId || accs[0].appleId,
    driveUrl: data.webservices?.drivews?.url,
    docUrl: data.webservices?.docws?.url,
    ckUrl: data.webservices?.ckdatabasews?.url,
    photosUrl: data.webservices?.photosws?.url,
    allServices: Object.keys(data.webservices || {})
  };
  cachedIcloudWsAt = Date.now();
  return cachedIcloudWs;
}

async function listIcloudDriveItems(forceRefresh = false) {
  if (!forceRefresh && cachedDriveListing && Date.now() - cachedDriveListingAt < 30 * 1000) {
    return cachedDriveListing;
  }
  const ws = await getIcloudWebservices();
  const queryParams = `clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;

  // 1. 查询根目录
  const rRoot = await fetch(`${ws.driveUrl}/retrieveItemDetailsInFolders?${queryParams}`, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify([{ drivewsid: "FOLDER::com.apple.CloudDocs::root", partialData: false }])
  });
  const rootArr = await rRoot.json();
  const rootFolder = rootArr?.[0] || {};
  const rootItems = rootFolder.items || [];

  const allFiles = [];
  const subFoldersToQuery = [];

  for (const item of rootItems) {
    if (item.type === "FILE") {
      allFiles.push({
        docwsid: item.docwsid,
        drivewsid: item.drivewsid,
        name: item.extension ? `${item.name}.${item.extension}` : item.name,
        rawName: item.name,
        extension: item.extension || "",
        size: item.size || 0,
        folderName: "iCloud 云盘根目录",
        zone: item.zone || "com.apple.CloudDocs"
      });
    } else if (item.type === "FOLDER" && item.drivewsid) {
      subFoldersToQuery.push({ name: item.name, drivewsid: item.drivewsid, docwsid: item.docwsid });
    }
  }

  // 2. 批量展开前 15 个核心子文件夹（包含 简历、学习照片、高数例题 等）
  if (subFoldersToQuery.length > 0) {
    const batch = subFoldersToQuery.slice(0, 15);
    const rSub = await fetch(`${ws.driveUrl}/retrieveItemDetailsInFolders?${queryParams}`, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(batch.map(f => ({ drivewsid: f.drivewsid, partialData: false })))
    });
    const subArr = await rSub.json();
    if (Array.isArray(subArr)) {
      for (const sf of subArr) {
        const folderLabel = sf.name || "子文件夹";
        for (const item of sf.items || []) {
          if (item.type === "FILE") {
            allFiles.push({
              docwsid: item.docwsid,
              drivewsid: item.drivewsid,
              name: item.extension ? `${item.name}.${item.extension}` : item.name,
              rawName: item.name,
              extension: item.extension || "",
              size: item.size || 0,
              folderName: folderLabel,
              zone: item.zone || "com.apple.CloudDocs"
            });
          }
        }
      }
    }
  }

  // 3. 读取备忘录已同步的原生图片附件 (按修改时间倒序排列，最新上传的在最前)
  const noteImages = [];
  if (fs.existsSync(ATTACHMENTS_DIR)) {
    const files = fs
      .readdirSync(ATTACHMENTS_DIR)
      .filter(f => /\.(png|jpe?g|gif|webp|heic)$/i.test(f))
      .map(f => {
        const fp = path.join(ATTACHMENTS_DIR, f);
        const st = fs.statSync(fp);
        return {
          fileName: f,
          size: st.size,
          mtimeMs: st.mtimeMs,
          mtime: st.mtime.toLocaleTimeString("zh-CN", { hour12: false }),
          localPath: fp
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 12);
    noteImages.push(...files);
  }

  cachedDriveListing = {
    account: { fullName: ws.fullName, appleId: ws.appleId, dsid: ws.dsid, services: ws.allServices },
    folders: subFoldersToQuery,
    files: allFiles,
    noteImages
  };
  cachedDriveListingAt = Date.now();
  return cachedDriveListing;
}

async function downloadIcloudDriveFile(docwsid, fileNameHint = "icloud_file.pdf") {
  const ws = await getIcloudWebservices();
  const queryParams = `document_id=${encodeURIComponent(docwsid)}&clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;
  const rInfo = await fetch(`${ws.docUrl}/ws/com.apple.CloudDocs/download/by_id?${queryParams}`, {
    method: "GET",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie
    }
  });
  if (!rInfo.ok) throw new Error(`docws download/by_id HTTP ${rInfo.status}`);
  const dlInfo = await rInfo.json();
  const downloadUrl = dlInfo?.data_token?.url;
  if (!downloadUrl) throw new Error("未获取到 iCloud 云盘文件下载链接");

  const rBytes = await fetch(downloadUrl);
  if (!rBytes.ok) throw new Error(`下载云盘文件实体失败 HTTP ${rBytes.status}`);
  const buf = Buffer.from(await rBytes.arrayBuffer());

  const safeName = fileNameHint.replace(/[\\/:*?"<>|]/g, "_");
  const localPath = path.join(MEDIA_SAVE_DIR, safeName);
  fs.writeFileSync(localPath, buf);
  addLog("ICLOUD-DRIVE", `已从 iCloud 云盘拉取文件《${safeName}》 (${(buf.length / 1024).toFixed(1)} KB)`);
  return { localPath, fileName: safeName, size: buf.length };
}

async function uploadFileToIcloudDrive(fileBuffer, fileName, contentType = "image/png", parentFolderDocwsid = DRIVE_PHOTO_FOLDER_ID) {
  const ws = await getIcloudWebservices();
  const queryParams = `clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;

  // Step 1: 申请上传 URL
  const r1 = await fetch(`${ws.docUrl}/ws/com.apple.CloudDocs/upload/web?${queryParams}`, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify({
      filename: fileName,
      type: "FILE",
      content_type: contentType,
      size: fileBuffer.length
    })
  });
  if (!r1.ok) throw new Error(`Drive upload/web HTTP ${r1.status}`);
  const up1 = (await r1.json())[0];

  // Step 2: 上传二进制流至 cws.icloud-content.com.cn
  const form = new FormData();
  form.append("files", new Blob([fileBuffer], { type: contentType }), fileName);
  const r2 = await fetch(up1.url, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie
    },
    body: form
  });
  if (!r2.ok) throw new Error(`Drive singleFileUpload HTTP ${r2.status}`);
  const up2 = await r2.json();
  const sf = up2.singleFile;

  // Step 3: 挂载到指定 iCloud 云盘目录 (默认: 学习照片)
  const r3 = await fetch(`${ws.docUrl}/ws/com.apple.CloudDocs/update/documents?${queryParams}`, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify({
      data: {
        signature: sf.fileChecksum,
        wrapping_key: sf.wrappingKey,
        reference_signature: sf.referenceChecksum,
        receipt: sf.receipt,
        size: sf.size
      },
      command: "add_file",
      document_id: up1.document_id,
      path: {
        starting_document_id: parentFolderDocwsid,
        path: fileName
      },
      allow_conflict: true,
      file_flags: {
        is_writable: true,
        is_executable: false,
        is_hidden: false
      }
    })
  });
  if (!r3.ok) throw new Error(`Drive update/documents HTTP ${r3.status}`);
  const res3 = await r3.json();
  cachedDriveListingAt = 0; // 刷新列表缓存
  addLog("ICLOUD-DRIVE", `✅ 已将《${fileName}》直传至 iCloud 云盘/学习照片 (${sf.size} B)`);
  return { documentId: up1.document_id, fileName, size: sf.size, raw: res3 };
}

function setAttachmentRunAtOffset(doc, charOffset, attId, typeUTI) {
  const out = [];
  let pos = 0;
  for (const run of doc.attributeRuns) {
    const start = pos;
    const end = pos + run.length;
    pos = end;
    if (charOffset >= start && charOffset < end) {
      const beforeLen = charOffset - start;
      const afterLen = end - (charOffset + 1);
      if (beforeLen > 0) {
        const b = clone(AttributeRunSchema, run);
        b.length = beforeLen;
        out.push(b);
      }
      out.push(
        create(AttributeRunSchema, {
          length: 1,
          attachmentInfo: create(AttachmentInfoSchema, {
            attachmentIdentifier: attId,
            typeUTI
          })
        })
      );
      if (afterLen > 0) {
        const a = clone(AttributeRunSchema, run);
        a.length = afterLen;
        out.push(a);
      }
    } else {
      out.push(run);
    }
  }
  doc.attributeRuns = out;
}

async function embedImageIntoAppleNote(imageBuffer, fileName = "wechat_photo.png", captionText = "微信图片直传") {
  const ws = await getIcloudWebservices();
  const ext = path.extname(fileName).toLowerCase();
  const typeUTI = ext === ".jpg" || ext === ".jpeg" ? "public.jpeg" : "public.png";
  const attId = crypto.randomUUID().toUpperCase();
  const mediaId = crypto.randomUUID().toUpperCase();
  const ckParams = `ckjsBuildVersion=2530Project32&ckjsVersion=2.6.3&clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;

  // 1. 申请 CloudKit Media.Asset 上传地址
  const rUp = await fetch(`${ws.ckUrl}/database/1/com.apple.notes/production/private/assets/upload?${ckParams}`, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify({
      zoneID: { zoneName: "Notes" },
      tokens: [{ recordName: mediaId, recordType: "Media", fieldName: "Asset" }]
    })
  });
  if (!rUp.ok) throw new Error(`CloudKit assets/upload HTTP ${rUp.status}`);
  const tok = (await rUp.json()).tokens?.[0];
  if (!tok?.url) throw new Error("未获取到 CloudKit Media 上传地址");

  // 2. 上传图片字节流
  const rSf = await fetch(tok.url, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie
    },
    body: imageBuffer
  });
  if (!rSf.ok) throw new Error(`CloudKit singleFileUpload HTTP ${rSf.status}`);
  const sf = (await rSf.json()).singleFile;

  // 3. 查询或创建《🖼️ 微信图片速记测试》备忘录记录并追加 U+FFFC AttachmentInfo
  const lookedUp = await lookupRecords(ws.session, ws.ckUrl, ws.dsid, "private", { zoneName: "Notes" }, [GALLERY_NOTE_RECORD_NAME]);
  const current = lookedUp?.[0];
  const timeStr = new Date().toLocaleString("zh-CN", { hour12: false });
  const nowMs = Date.now();
  let noteOp;

  if (current && current.fields?.TextDataEncrypted?.value) {
    const raw = decompressNoteDocument(Buffer.from(current.fields.TextDataEncrypted.value, "base64"));
    const doc = parseNoteDocument(raw);
    const addition = `\n[${timeStr}] ${captionText} (${fileName})\n\uFFFC\n`;
    const newText = doc.text + addition;
    const fffcOffset = newText.lastIndexOf("\uFFFC");
    applyTextEdit(doc, newText, { replicaId: crypto.randomBytes(16) });
    setAttachmentRunAtOffset(doc, fffcOffset, attId, typeUTI);
    const compressed = compressNoteDocument(encodeNoteDocument(doc));
    const updateFields = buildNoteUpdateFields(current, compressed.toString("base64"), newText, nowMs);
    noteOp = {
      operationType: "update",
      record: {
        recordName: GALLERY_NOTE_RECORD_NAME,
        recordType: "Note",
        recordChangeTag: current.recordChangeTag,
        fields: updateFields
      }
    };
  } else {
    const titleText = "🖼️ 微信图片速记测试";
    const fullText = `${titleText}\n[${timeStr}] ${captionText} (${fileName})\n\uFFFC\n`;
    const fffcOffset = fullText.lastIndexOf("\uFFFC");
    const doc = buildInitialNoteDocument(fullText, crypto.randomBytes(16));
    setAttachmentRunAtOffset(doc, fffcOffset, attId, typeUTI);
    const compressed = compressNoteDocument(encodeNoteDocument(doc));
    const createFields = buildNoteCreateFields(compressed.toString("base64"), fullText, nowMs);
    noteOp = {
      operationType: "create",
      record: {
        recordName: GALLERY_NOTE_RECORD_NAME,
        recordType: "Note",
        fields: createFields
      }
    };
  }

  const rMod = await fetch(`${ws.ckUrl}/database/1/com.apple.notes/production/private/records/modify?${ckParams}`, {
    method: "POST",
    headers: {
      Origin: "https://www.icloud.com.cn",
      Referer: "https://www.icloud.com.cn/",
      Cookie: ws.session.cookie,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify({
      zoneID: { zoneName: "Notes" },
      operations: [
        noteOp,
        {
          operationType: "create",
          record: {
            recordName: mediaId,
            recordType: "Media",
            parent: { recordName: GALLERY_NOTE_RECORD_NAME },
            fields: {
              Asset: { value: sf },
              FilenameEncrypted: { value: Buffer.from(fileName, "utf-8").toString("base64") },
              Deleted: { value: 0 },
              MinimumSupportedNotesVersion: { value: 0 }
            }
          }
        },
        {
          operationType: "create",
          record: {
            recordName: attId,
            recordType: "Attachment",
            parent: { recordName: GALLERY_NOTE_RECORD_NAME },
            fields: {
              UTI: { value: typeUTI },
              UTIEncrypted: { value: Buffer.from(typeUTI, "utf-8").toString("base64") },
              CreationDate: { value: nowMs },
              LastModificationDate: { value: nowMs },
              FileSize: { value: sf.size },
              Deleted: { value: 0 },
              MinimumSupportedNotesVersion: { value: 0 },
              Media: { value: { recordName: mediaId, action: "VALIDATE", zoneID: { zoneName: "Notes" } } },
              Note: { value: { recordName: GALLERY_NOTE_RECORD_NAME, action: "VALIDATE", zoneID: { zoneName: "Notes" } } }
            }
          }
        }
      ]
    })
  });
  if (!rMod.ok) throw new Error(`CloudKit records/modify HTTP ${rMod.status}`);
  // 同时保存在本地 attachments 目录供即时预览与微信发送
  if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ATTACHMENTS_DIR, fileName), imageBuffer);
  cachedDriveListingAt = 0;
  addLog("CLOUDKIT-IMG", `✅ 已将原图《${fileName}》作为原生 Attachment 嵌入 Apple 备忘录《🖼️ 微信图片速记测试》`);
  // 异步拉取最新状态到本地
  setTimeout(() => checkOutboxAndPull(botInstance), 1500);
  return { noteRecordName: GALLERY_NOTE_RECORD_NAME, attachmentRecordName: attId, mediaRecordName: mediaId, fileName, size: sf.size };
}

async function bridgeImageToDriveAndNotes(imageBuffer, fileName, captionText = "微信图片直传") {
  const driveRes = await uploadFileToIcloudDrive(imageBuffer, fileName, fileName.endsWith(".jpg") ? "image/jpeg" : "image/png");
  const noteRes = await embedImageIntoAppleNote(imageBuffer, fileName, captionText);
  return { driveRes, noteRes };
}

// ============================================================================
// 3. 备忘录检索与动态多分类校准引擎
// ============================================================================
function searchNotes(keyword, maxResults = 6) {
  const results = [];
  const kwList = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (kwList.length === 0) return results;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    for (const f of list) {
      if (f === ".icloud-md" || f === "attachments") continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (f.endsWith(".md")) {
        const raw = fs.readFileSync(full, "utf-8");
        let body = raw;
        if (raw.startsWith("---")) {
          const endIdx = raw.indexOf("---", 3);
          if (endIdx !== -1) body = raw.slice(endIdx + 3).trim();
        }
        const title = f.replace(/\.md$/, "");
        const combined = `${title}\n${body}`.toLowerCase();

        const matchedKw = kwList.find(k => combined.includes(k));
        if (matchedKw) {
          const idx = body.toLowerCase().indexOf(matchedKw);
          const start = Math.max(0, idx - 30);
          const end = Math.min(body.length, (idx === -1 ? 0 : idx) + matchedKw.length + 90);
          const snippet = body.slice(start, end).replace(/\r?\n/g, " ").trim();
          results.push({ title, snippet: snippet || body.slice(0, 100).replace(/\r?\n/g, " "), fullBody: body.slice(0, 800) });
          if (results.length >= maxResults) break;
        }
      }
    }
  }
  walk(NOTES_SUBDIR);
  return results;
}

function classifyMessageIntent(text, hasMedia = false) {
  const t = (text || "").trim();
  const lower = t.toLowerCase();

  const isExplicitNotePrefix = /^(记一下|记个|备忘|存档|#记|\/记|todo[:：]|待办[:：])/i.test(t);
  const isQuestionOrChat =
    !isExplicitNotePrefix &&
    !hasMedia &&
    (
      /[?？]$/.test(t) ||
      /^(你好|嗨|hello|hi|在吗|你是谁|请问|帮我|告诉我|为什么|怎么|如何|什么是|查一下|找一下|搜一下|总结|翻译|写一|解释|分析|算一下|背诵|把)/i.test(t) ||
      /(备忘录|云盘|icloud|图库|照片|简历|文件).*(有什么|是多少|在哪|发给我|找|查|列表|看看)/i.test(t) ||
      /(我之前记的|帮我查|跟我聊聊|发给我)/i.test(t)
    );

  // 动态计算所有规则（包括用户自定义新增的分类本）的匹配得分
  const rawWeights = {};
  let matchedAny = false;

  for (const r of vaultRules) {
    let hits = 0;
    for (const kw of r.keywords) {
      if (kw && lower.includes(kw.toLowerCase())) hits++;
    }
    if (hits > 0) {
      rawWeights[r.id] = 10 + hits * 15;
      matchedAny = true;
    } else {
      rawWeights[r.id] = r.id === "idea" ? 2 : 0.4;
    }
  }

  if (!matchedAny) {
    rawWeights["idea"] = 25;
  }

  const totalWeight = Object.values(rawWeights).reduce((a, b) => a + b, 0) || 1;
  const probabilities = {};
  for (const r of vaultRules) {
    probabilities[r.id] = Number((rawWeights[r.id] / totalWeight).toFixed(2));
  }

  const sorted = [...vaultRules].sort((a, b) => (probabilities[b.id] || 0) - (probabilities[a.id] || 0));
  const topRule = sorted[0] || vaultRules[0];

  return {
    isQuestionOrChat,
    topCategory: topRule.id,
    categoryName: topRule.fileName,
    rule: topRule,
    siriPrompt: topRule.siriPrompt || `“嘿 Siri，查一下我备忘录里的 ${topRule.title}”`,
    probabilities
  };
}

function saveClassifiedNote(text, categoryId = null, mediaInfo = null) {
  const timeStr = new Date().toLocaleString("zh-CN", { hour12: false });
  const analysis = classifyMessageIntent(text, Boolean(mediaInfo));
  const targetRule = (categoryId && vaultRules.find(r => r.id === categoryId)) || analysis.rule;
  const targetPath = path.join(NOTES_SUBDIR, targetRule.fileName);

  ensureAllVaultFiles(vaultRules);

  const cleanText = (text || "").replace(/^(记一下|记个|备忘|存档|#记|\/记)[:：\s]*/i, "").trim();
  let formattedEntry = "";
  if (targetRule.isTodo) {
    formattedEntry = `\n- [ ] ${cleanText || "[图片待办]"} (${timeStr})\n`;
  } else {
    formattedEntry = `\n### ${timeStr}\n• ${cleanText || "[媒体附件]"}\n`;
  }

  if (mediaInfo) {
    formattedEntry += `  - 🖼️ [图库⇄备忘录联动]: 已同步原图至《🖼️ 微信图片速记测试》及 iCloud 云盘/学习照片/${path.basename(mediaInfo.savedPath)}\n`;
  }

  fs.appendFileSync(targetPath, formattedEntry, "utf-8");

  if (fs.existsSync(INBOX_NOTE_PATH)) {
    fs.appendFileSync(INBOX_NOTE_PATH, `\n### ${timeStr} [${targetRule.title}]\n${cleanText || "[图片直传]"}\n`, "utf-8");
  }

  triggerIcloudPush(2000);
  addLog("CLASSIFY", `已自动归类写入《${targetRule.fileName}》 (p=${analysis.probabilities[targetRule.id]})`);

  return {
    category: targetRule.id,
    categoryName: targetRule.fileName,
    probabilities: analysis.probabilities,
    siriPrompt: targetRule.siriPrompt,
    cleanText
  };
}

// ============================================================================
// 4. 本地双模 AI Agent 引擎 (WorkBuddy DeepSeek-V4.1-Flash + 备忘录 + iCloud 云盘工具链)
// ============================================================================
function buildAgentTools() {
  const enumIds = vaultRules.map(r => r.id);
  const descList = vaultRules.map(r => `${r.id}(${r.title})`).join(", ");
  return [
    {
      type: "function",
      function: {
        name: "search_apple_notes",
        description: "当用户询问个人备忘录里的内容（如密码、账号、老师办公室、车次、打卡计划、待办、图片速记等）时，搜索所有 iPhone 备忘录并返回匹配内容。",
        parameters: {
          type: "object",
          properties: {
            keywords: { type: "string", description: "搜索关键词，多个词用空格分隔" }
          },
          required: ["keywords"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "save_to_apple_notes",
        description: "当用户在对话中要求记录、保存某条信息到备忘录时调用。",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "要保存的正文内容" },
            category: { type: "string", enum: enumIds, description: `分类ID：${descList}` }
          },
          required: ["content", "category"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_icloud_drive",
        description: "当用户询问 iCloud 云盘里有什么文件、简历、PDF、学习照片、文件夹，或者想找某个云盘文件时调用。",
        parameters: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "文件名或文件夹关键词（若查看全部可传空字符串）" }
          },
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "send_icloud_file_or_photo_to_wechat",
        description: "当用户要求把 iCloud 云盘里的某个文件（如个人简历 PDF、数据表示课件）或备忘录图库里的照片发送到微信时调用。",
        parameters: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "要发送的文件名或图片名关键词，例如 '个人简历' 或 'wechat_image'" }
          },
          required: ["keyword"]
        }
      }
    }
  ];
}

async function runConversationalAgent(conversationId, userText) {
  const history = chatSessions.get(conversationId) || [];
  const systemPrompt = `你是用户的专属微信 AI 助手兼 Apple iCloud 全家桶智能管家（NoteBridge AI）。
你同时具备三大核心能力：
1. 【全能 AI 问答 Agent】：自然、聪明、简洁地回答用户的任何问题。
2. 【个人备忘录大脑】：可调用 \`search_apple_notes\` 检索用户 iPhone 备忘录，或调用 \`save_to_apple_notes\` 存入分类备忘录。
3. 【iCloud 云盘与原生图库联动】：你已打通用户的 iCloud 云盘（p211-drivews.icloud.com.cn）与备忘录原生图库。当用户询问云盘文件时调用 \`search_icloud_drive\`；当用户说“把云盘里的简历发给我”或“把图库照片发给我”时，调用 \`send_icloud_file_or_photo_to_wechat\` 直接把真文件/真图发回用户微信！
回答请保持清爽干练，适合微信阅读。`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: userText }
  ];

  let outboundMedia = null;

  try {
    const resp = await fetch("http://127.0.0.1:3425/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openai-actor-authorization": "magpie"
      },
      body: JSON.stringify({
        model: "workbuddy/deepseek-v4.1-flash",
        messages,
        tools: buildAgentTools(),
        tool_choice: "auto",
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Empty LLM response");

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const fnName = tc.function?.name;
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}

        let toolResult = "";
        if (fnName === "search_apple_notes") {
          const hits = searchNotes(args.keywords || userText, 5);
          addLog("AGENT-TOOL", `AI 检索了备忘录关键词: "${args.keywords}" (命中 ${hits.length} 篇)`);
          toolResult = hits.length > 0
            ? JSON.stringify(hits.map(h => ({ title: h.title, content: h.fullBody })))
            : "未找到匹配的备忘录，请尝试其他关键词或直接回答。";
        } else if (fnName === "save_to_apple_notes") {
          const saved = saveClassifiedNote(args.content || userText, args.category);
          addLog("AGENT-TOOL", `AI 将内容存入了《${saved.categoryName}》`);
          toolResult = `已成功存入 iPhone 备忘录《${saved.categoryName}》，并触发 iCloud 同步。`;
        } else if (fnName === "search_icloud_drive") {
          const listing = await listIcloudDriveItems();
          const kw = (args.keyword || "").trim().toLowerCase();
          const matchedFiles = kw
            ? listing.files.filter(f => f.name.toLowerCase().includes(kw) || f.folderName.toLowerCase().includes(kw))
            : listing.files;
          addLog("AGENT-TOOL", `AI 检索了 iCloud 云盘: "${kw || "全部"}" (命中 ${matchedFiles.length} 个文件)`);
          toolResult = JSON.stringify({
            folders: listing.folders.map(f => f.name),
            files: matchedFiles.map(f => ({ name: f.name, folder: f.folderName, sizeKB: Math.round(f.size / 1024), docwsid: f.docwsid })),
            noteGalleryImages: listing.noteImages.slice(0, 6).map(img => img.fileName)
          });
        } else if (fnName === "send_icloud_file_or_photo_to_wechat") {
          const kw = (args.keyword || "").trim().toLowerCase();
          const listing = await listIcloudDriveItems();
          const targetFile = listing.files.find(f => f.name.toLowerCase().includes(kw) || f.rawName.toLowerCase().includes(kw));
          if (targetFile) {
            const dl = await downloadIcloudDriveFile(targetFile.docwsid, targetFile.name);
            const isImg = /\.(png|jpe?g|gif|webp)$/i.test(dl.fileName);
            outboundMedia = {
              type: isImg ? "image" : "file",
              url: dl.localPath,
              fileName: dl.fileName
            };
            addLog("AGENT-TOOL", `AI 已从 iCloud 云盘提取《${dl.fileName}》准备发往微信`);
            toolResult = `已成功从 iCloud 云盘（${targetFile.folderName}）拉取文件《${dl.fileName}》（${Math.round(dl.size / 1024)} KB），已挂载为微信附件直接发送给用户。`;
          } else {
            const targetImg = listing.noteImages.find(i => i.fileName.toLowerCase().includes(kw)) || listing.noteImages[0];
            if (targetImg) {
              outboundMedia = {
                type: "image",
                url: targetImg.localPath,
                fileName: targetImg.fileName
              };
              addLog("AGENT-TOOL", `AI 已从备忘录图库提取《${targetImg.fileName}》准备发往微信`);
              toolResult = `已从备忘录原生图库找到图片《${targetImg.fileName}》，已挂载为微信图片直接发送给用户。`;
            } else {
              toolResult = `未在 iCloud 云盘或备忘录图库中找到匹配 "${args.keyword}" 的文件。`;
            }
          }
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
      }

      const secondResp = await fetch("http://127.0.0.1:3425/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openai-actor-authorization": "magpie"
        },
        body: JSON.stringify({
          model: "workbuddy/deepseek-v4.1-flash",
          messages,
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(25000)
      });
      const secondData = await secondResp.json();
      const finalReply = secondData.choices?.[0]?.message?.content || "✅ 已完成 iCloud 操作。";

      history.push({ role: "user", content: userText }, { role: "assistant", content: finalReply });
      chatSessions.set(conversationId, history.slice(-16));
      return { replyText: finalReply, outboundMedia };
    }

    const replyText = msg.content || "收到！";
    history.push({ role: "user", content: userText }, { role: "assistant", content: replyText });
    chatSessions.set(conversationId, history.slice(-16));
    return { replyText, outboundMedia };
  } catch (err) {
    addLog("WARN", `AI Agent 降级为本地备忘录检索 (${err.message})`);
    const cleanKw = userText.replace(/(备忘录|查一下|找一下|里的|是多少|在哪|有什么|[?？])/g, " ").trim();
    const hits = searchNotes(cleanKw, 3);
    if (hits.length > 0) {
      return {
        replyText: `🤖 [智能检索] 在你的备忘录中找到：\n` + hits.map((h, i) => `${i + 1}. 《${h.title}》：${h.snippet}`).join("\n"),
        outboundMedia: null
      };
    }
    return { replyText: `🤖 [NoteBridge 助手] 收到你的消息：「${userText}」。`, outboundMedia: null };
  }
}

// ============================================================================
// 5. 统一消息路由核心 (支持文本、微信发图直通 iCloud 云盘 + 备忘录原生嵌图)
// ============================================================================
async function handleUnifiedMessage({ conversationId = "web-console", text = "", media = null }) {
  const startTime = Date.now();
  const trimmed = (text || "").trim();

  if (trimmed.startsWith("/查 ") || trimmed.startsWith("/搜 ")) {
    const kw = trimmed.slice(3).trim();
    const res = searchNotes(kw, 5);
    const reply = res.length === 0
      ? `🔍 未找到包含「${kw}」的备忘录。`
      : `🔍 找到包含「${kw}」的备忘录：\n` + res.map((r, i) => `\n${i + 1}. 📄【${r.title}】\n   "${r.snippet}"`).join("");
    return { reply, modeUsed: "FAST_SEARCH", classification: lastClassification };
  }

  if (trimmed === "/mode" || trimmed.startsWith("/mode ")) {
    const arg = trimmed.replace("/mode", "").trim().toUpperCase();
    if (["DUAL_AUTO", "AGENT_FIRST", "NOTES_FIRST"].includes(arg)) {
      currentMode = arg;
      return { reply: `⚙️ 已切换运行模式为：${currentMode}`, modeUsed: "SYSTEM", classification: lastClassification };
    }
  }

  let mediaInfo = null;
  let cloudBridgeInfo = null;
  if (media && media.filePath && fs.existsSync(media.filePath)) {
    const ext = path.extname(media.fileName || media.filePath) || ".png";
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const baseClean = (media.fileName || "wechat_img").replace(/\.[^.]+$/, "");
    const newFileName = `${timestamp}_${baseClean}${ext.startsWith(".") ? ext : "." + ext}`;
    const destPath = path.join(MEDIA_SAVE_DIR, newFileName);
    fs.copyFileSync(media.filePath, destPath);
    mediaInfo = { savedPath: destPath, type: media.type, fileName: newFileName };

    // 当微信收到图片时：直接上传到 iCloud 云盘《学习照片》+ 作为原生 Attachment 嵌入 Apple 备忘录《🖼️ 微信图片速记测试》！
    if (media.type === "image" || /\.(png|jpe?g|gif|webp)$/i.test(newFileName)) {
      try {
        const imgBuf = fs.readFileSync(destPath);
        cloudBridgeInfo = await bridgeImageToDriveAndNotes(imgBuf, newFileName, trimmed || "微信随手拍直传");
      } catch (e) {
        addLog("WARN", `图片直传 iCloud 云盘/备忘录异常: ${e.message}`);
      }
    } else {
      try {
        const fileBuf = fs.readFileSync(destPath);
        const driveRes = await uploadFileToIcloudDrive(fileBuf, newFileName, media.mimeType || "application/octet-stream");
        cloudBridgeInfo = { driveRes };
      } catch (e) {
        addLog("WARN", `文件直传 iCloud 云盘异常: ${e.message}`);
      }
    }
  }

  const intent = classifyMessageIntent(trimmed, Boolean(mediaInfo));

  const shouldRunAgent =
    !mediaInfo &&
    (currentMode === "AGENT_FIRST" ||
      (currentMode === "DUAL_AUTO" && intent.isQuestionOrChat) ||
      trimmed.startsWith("/ai "));

  if (shouldRunAgent) {
    const queryText = trimmed.replace(/^\/ai\s+/i, "");
    addLog("AI-AGENT", `识别为【问答/Agent 指令】: "${queryText.slice(0, 50)}"`);
    const { replyText: agentReply, outboundMedia } = await runConversationalAgent(conversationId, queryText);
    const latencyMs = Date.now() - startTime;

    lastClassification = {
      text: queryText,
      category: intent.topCategory,
      categoryName: outboundMedia ? `📂 iCloud 云盘提取 (${outboundMedia.fileName})` : "🤖 AI Agent 问答对话",
      probabilities: intent.probabilities,
      modeUsed: "AI_AGENT_QA",
      agentReply,
      siriQuery: "“嘿 Siri，查一下我备忘录里的相关记录”",
      siriAnswer: agentReply.slice(0, 180),
      latencyMs,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
    };

    return { reply: agentReply, outboundMedia, modeUsed: "AI_AGENT_QA", classification: lastClassification };
  } else {
    const saved = saveClassifiedNote(trimmed, intent.topCategory, mediaInfo);
    const latencyMs = Date.now() - startTime;
    const bridgeNotice = cloudBridgeInfo?.noteRes
      ? `\n🖼️ [图库⇄备忘录互通]：\n  1. 已直传 iCloud 云盘《学习照片/${mediaInfo.fileName}》\n  2. 已作为原生图片嵌入备忘录《🖼️ 微信图片速记测试》`
      : "";
    const reply = `✅ [AI 已自动归类 ➔ 《${saved.categoryName.replace(".md", "")}》]\n📝 内容：${saved.cleanText || "[微信图片/附件]"}${bridgeNotice}\n🎙️ 现在你可以随时对 iPhone 喊：\n${saved.siriPrompt}`;

    lastClassification = {
      text: trimmed || `[微信图片] ${mediaInfo?.fileName || ""}`,
      category: saved.category,
      categoryName: saved.categoryName,
      probabilities: saved.probabilities,
      modeUsed: "NOTE_ARCHIVE",
      agentReply: reply,
      siriQuery: saved.siriPrompt,
      siriAnswer: `在你的 iPhone 备忘录《${saved.categoryName.replace(".md", "")}》与《🖼️ 微信图片速记测试》中找到：\n• ${saved.cleanText || mediaInfo?.fileName || "[媒体附件]"}`,
      latencyMs,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
    };

    return { reply, modeUsed: "NOTE_ARCHIVE", classification: lastClassification };
  }
}

// ============================================================================
// 6. 微信 ClawBot 启动与扫码即登录会话
// ============================================================================
function startWechatBot() {
  try {
    if (!isLoggedIn()) {
      addLog("WARN", "当前尚未绑定微信账号，请在 Quickstart 向导中扫码绑定");
      return;
    }
    botInstance = start(
      {
        clearSession(conversationId) {
          chatSessions.delete(conversationId);
          addLog("WECHAT", `已清除会话上下文: ${conversationId}`);
        },
        async chat(req) {
          addLog("INBOUND", `收到微信消息: ${(req.text || "").slice(0, 60)}${req.media ? ` [含媒体:${req.media.type}]` : ""}`);
          const result = await handleUnifiedMessage({
            conversationId: req.conversationId,
            text: req.text,
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
      { outputFormat: "markdown" }
    );
    addLog("SYSTEM", "✅ 微信 ClawBot 双向双模引擎已启动 (支持 AI 问答 + 备忘录归类 + iCloud 云盘/图库直通)");
  } catch (err) {
    addLog("ERROR", `启动微信 Bot 失败: ${err.message}`);
  }
}

setInterval(() => {
  if (botInstance) checkOutboxAndPull(botInstance);
}, 30000);

let activeQrSession = null;

async function createWechatQrSession() {
  const resp = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "iLink-App-Id": "ilink_openclaw_bot",
      "iLink-App-ClientVersion": "1"
    },
    body: JSON.stringify({ local_token_list: [] })
  });
  const data = await resp.json();
  if (!data.qrcode_img_content) throw new Error("未获取到二维码链接");

  const qrDataUrl = await QRCode.toDataURL(data.qrcode_img_content, {
    width: 240,
    margin: 1,
    color: { dark: "#1E1E1E", light: "#FEFEFE" }
  });
  activeQrSession = {
    qrcode: data.qrcode,
    qrcodeUrl: data.qrcode_img_content,
    qrDataUrl,
    status: "wait",
    createdAt: Date.now()
  };
  addLog("AUTH", "已在 Quickstart 生成全新微信 ClawBot 扫码登录凭证");
  return activeQrSession;
}

// ============================================================================
// 7. 读取分类备忘录与系统状态快照
// ============================================================================
function readVaultPreview(fileName, maxLines = 6) {
  const filePath = path.join(NOTES_SUBDIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  let body = raw;
  if (raw.startsWith("---")) {
    const endIdx = raw.indexOf("---", 3);
    if (endIdx !== -1) body = raw.slice(endIdx + 3).trim();
  }
  const lines = body
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith(">") && !l.startsWith("# ") && !vaultRules.some(r => l === r.title));
  return lines.slice(-maxLines).reverse();
}

function getSystemStatus() {
  let noteCount = 0;
  let attachmentCount = 0;
  if (fs.existsSync(NOTES_SUBDIR)) {
    noteCount = fs.readdirSync(NOTES_SUBDIR).filter(f => f.endsWith(".md")).length;
  }
  if (fs.existsSync(ATTACHMENTS_DIR)) {
    attachmentCount = fs.readdirSync(ATTACHMENTS_DIR).length;
  }

  const wxDir = path.join(os.homedir(), ".openclaw", "openclaw-weixin", "accounts");
  let wxAccount = "4547d85e4cb2-im-bot";
  let wxUser = "o9cq80-tfDJosoOFqzSVuTuwdjA4@im.wechat";
  const wxConnected = isLoggedIn();
  try {
    if (fs.existsSync(wxDir)) {
      const files = fs.readdirSync(wxDir).filter(f => f.endsWith(".json") && !f.endsWith(".sync.json") && !f.endsWith(".context-tokens.json"));
      if (files.length > 0) {
        wxAccount = files[0].replace(".json", "");
        const accData = JSON.parse(fs.readFileSync(path.join(wxDir, files[0]), "utf-8"));
        if (accData.userId) wxUser = accData.userId;
      }
    }
  } catch {}

  const vaultsData = {};
  for (const r of vaultRules) {
    vaultsData[r.id] = readVaultPreview(r.fileName, 5);
  }

  return {
    wechat: {
      connected: wxConnected,
      accountId: wxAccount,
      userId: wxUser,
      mode: currentMode
    },
    icloud: {
      connected: noteCount > 0,
      host: "setup.icloud.com.cn (云上贵州)",
      noteCount,
      attachmentCount,
      isSyncing: isPushing || isPulling,
      lastSyncTime
    },
    rules: vaultRules,
    vaults: vaultsData,
    lastClassification,
    logs: activityLogs.slice(0, 20)
  };
}

// ============================================================================
// 8. HTTP Server (API + 静态页面服务)
// ============================================================================
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // API: 获取实时状态
  if (url.pathname === "/api/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(getSystemStatus()));
  }

  // API: 切换模式
  if (url.pathname === "/api/mode" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (["DUAL_AUTO", "AGENT_FIRST", "NOTES_FIRST"].includes(body.mode)) {
      currentMode = body.mode;
      addLog("MODE", `切换运行模式为: ${currentMode}`);
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, mode: currentMode, status: getSystemStatus() }));
  }

  // API: 新增自定义备忘录分类规则
  if (url.pathname === "/api/vaults/rules" && req.method === "POST") {
    const body = await readJsonBody(req);
    const title = (body.title || "").trim();
    const rawKeywords = (body.keywords || "").trim();
    const isTodo = Boolean(body.isTodo);

    if (!title || !rawKeywords) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: "分类名称和触发关键词不能为空" }));
    }

    const id = "custom_" + Date.now().toString(36);
    const keywords = rawKeywords.split(/[,，\s]+/).map(k => k.trim()).filter(Boolean);
    const fileName = title.endsWith(".md") ? title : `${title}.md`;

    const newRule = {
      id,
      title: title.replace(/\.md$/, ""),
      fileName,
      keywords,
      siriPrompt: `“嘿 Siri，查一下我备忘录里的 ${title.replace(/\.md$/, "")}”`,
      isTodo,
      builtIn: false
    };

    vaultRules.push(newRule);
    saveVaultRules(vaultRules);
    triggerIcloudPush(2000);
    addLog("VAULT", `新增自定义分类备忘录《${fileName}》 (关键词: ${keywords.join("/")})`);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, rule: newRule, status: getSystemStatus() }));
  }

  // API: 删除自定义分类规则
  if (url.pathname === "/api/vaults/rules" && req.method === "DELETE") {
    const body = await readJsonBody(req);
    const targetId = body.id;
    vaultRules = vaultRules.filter(r => r.builtIn || r.id !== targetId);
    saveVaultRules(vaultRules);
    addLog("VAULT", `已移除自定义分类规则: ${targetId}`);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, status: getSystemStatus() }));
  }

  // API: Playground 真实操演
  if (url.pathname === "/api/simulate" && req.method === "POST") {
    const body = await readJsonBody(req);
    const inputText = (body.text || "").trim();
    const pushToPhone = Boolean(body.pushToPhone);

    if (!inputText) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: "内容不能为空" }));
    }

    addLog("PLAYGROUND", `输入: "${inputText.slice(0, 50)}" (推手机微信=${pushToPhone})`);
    const result = await handleUnifiedMessage({
      conversationId: "web-live-operator",
      text: inputText
    });

    let pushedToWechat = false;
    if ((pushToPhone || result.outboundMedia) && botInstance) {
      try {
        if (result.outboundMedia) {
          await botInstance.sendMessage({
            text: `🖥️ [来自 NoteBridge AI · iCloud 提取]\n${result.reply}`,
            media: result.outboundMedia
          });
        } else {
          await botInstance.sendMessage(`🖥️ [来自 NoteBridge Playground]\n你的输入：${inputText}\n\n${result.reply}`);
        }
        pushedToWechat = true;
        addLog("WECHAT", "✅ 已将本次操演结果及 iCloud 附件真实推送至你的手机微信！");
      } catch (e) {
        addLog("WARN", `推送手机微信失败: ${e.message}`);
      }
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      pushedToWechat,
      result,
      status: getSystemStatus()
    }));
  }

  // API: 获取真实 iCloud 云盘 (Drive) 文件列表与备忘录原生图库
  if (url.pathname === "/api/icloud/drive" && req.method === "GET") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const data = await listIcloudDriveItems(force);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, ...data }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // API: 一键将 iCloud 云盘文件或备忘录图库原图发送到手机微信
  if (url.pathname === "/api/icloud/drive/send-to-wechat" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      let mediaPayload = null;
      let label = "";

      if (body.docwsid) {
        const dl = await downloadIcloudDriveFile(body.docwsid, body.fileName || "icloud_file.pdf");
        const isImg = /\.(png|jpe?g|gif|webp)$/i.test(dl.fileName);
        mediaPayload = { type: isImg ? "image" : "file", url: dl.localPath, fileName: dl.fileName };
        label = `📂 [来自你的 iCloud 云盘]\n文件：${dl.fileName} (${(dl.size / 1024).toFixed(1)} KB)`;
      } else if (body.noteImageName) {
        const localPath = path.join(ATTACHMENTS_DIR, path.basename(body.noteImageName));
        if (!fs.existsSync(localPath)) throw new Error("本地图库附件不存在");
        mediaPayload = { type: "image", url: localPath, fileName: path.basename(localPath) };
        label = `🖼️ [来自你的 iPhone 备忘录图库]\n图片：${path.basename(localPath)}`;
      } else {
        throw new Error("缺少 docwsid 或 noteImageName 参数");
      }

      if (botInstance) {
        await botInstance.sendMessage({ text: label, media: mediaPayload });
        addLog("WECHAT", `✅ 已将 iCloud 文件/图片《${mediaPayload.fileName}》真实发送至你的手机微信！`);
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, sentFile: mediaPayload.fileName, status: getSystemStatus() }));
    } catch (e) {
      addLog("ERROR", `发送 iCloud 文件至微信失败: ${e.message}`);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // API: 图库 ⇄ 备忘录双向桥接实测 (上传图片同时写入 iCloud 云盘《学习照片》+ 备忘录原生嵌图)
  if (url.pathname === "/api/icloud/photo-bridge" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const caption = (body.caption || "微信视觉速记直传").trim();
      const rawFileName = (body.fileName || `NoteBridge_${Date.now().toString().slice(-5)}.png`).replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, "_");
      const fileName = /\.(png|jpe?g)$/i.test(rawFileName) ? rawFileName : `${rawFileName}.png`;

      let imgBuffer;
      if (body.dataUrl && body.dataUrl.includes("base64,")) {
        const b64 = body.dataUrl.split("base64,")[1];
        imgBuffer = Buffer.from(b64, "base64");
      } else {
        // 若未选择本地图片，则使用现有真实备忘录附件或生成标准测试 PNG
        const sampleExisting = fs.existsSync(ATTACHMENTS_DIR)
          ? fs.readdirSync(ATTACHMENTS_DIR).find(f => /\.(png|jpe?g)$/i.test(f))
          : null;
        if (sampleExisting) {
          imgBuffer = fs.readFileSync(path.join(ATTACHMENTS_DIR, sampleExisting));
        } else {
          imgBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
        }
      }

      const bridgeRes = await bridgeImageToDriveAndNotes(imgBuffer, fileName, caption);
      const savedNote = saveClassifiedNote(caption, null, { savedPath: path.join(ATTACHMENTS_DIR, fileName), type: "image", fileName });

      if (body.pushToPhone && botInstance) {
        await botInstance.sendMessage(
          `🖼️ [NoteBridge 图库⇄备忘录联动完成]\n1️⃣ 已直传 iCloud 云盘：学习照片/${fileName}\n2️⃣ 已原生嵌入备忘录：《🖼️ 微信图片速记测试》\n3️⃣ 已关联归档至：《${savedNote.categoryName.replace(".md", "")}》`
        );
      }

      const driveData = await listIcloudDriveItems(true);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true,
        fileName,
        caption,
        bridgeRes,
        savedNote,
        driveData,
        status: getSystemStatus()
      }));
    } catch (e) {
      addLog("ERROR", `图库⇄备忘录直传失败: ${e.message}`);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  // 静态图片预览: /attachments/<fileName>
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

  // API: 搜索真实备忘录
  if (url.pathname === "/api/notes/search" && req.method === "POST") {
    const body = await readJsonBody(req);
    const kw = (body.query || "").trim();
    const hits = searchNotes(kw, 5);
    addLog("SIRI-SEARCH", `检索备忘录关键词: "${kw}" (命中 ${hits.length} 篇)`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, query: kw, hits }));
  }

  // API: 立即触发 iCloud 双向同步
  if (url.pathname === "/api/icloud/sync" && req.method === "POST") {
    addLog("ICLOUD", "手动触发 iCloud 立即双向同步 (Pull + Push)...");
    await checkOutboxAndPull(botInstance);
    const pushRes = await executeIcloudPush();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, pushRes, status: getSystemStatus() }));
  }

  // API: 唤起 iCloud 云上贵州授权器
  if (url.pathname === "/api/icloud/relogin" && req.method === "POST") {
    addLog("AUTH", "正在拉起 iCloud 云上贵州授权窗口...");
    const batPath = path.join(__dirname, "login-apple.bat");
    spawn("cmd.exe", ["/c", "start", "", batPath], { detached: true, stdio: "ignore" }).unref();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: true, message: "已拉起 iCloud 云上贵州登录窗口" }));
  }

  // API: 生成真实微信扫码二维码
  if (url.pathname === "/api/wechat/qr" && req.method === "POST") {
    try {
      const qr = await createWechatQrSession();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, qrDataUrl: qr.qrDataUrl, qrcodeUrl: qr.qrcodeUrl }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  const htmlPath = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(htmlPath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(htmlPath, "utf-8"));
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  addLog("SERVER", `🚀 NoteBridge AI 产品级全栈服务已启动: http://localhost:${PORT}`);
  startWechatBot();
  setTimeout(() => {
    if (botInstance) checkOutboxAndPull(botInstance);
  }, 4000);
});
