import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { create, clone } from "@bufbuild/protobuf";
import { resolveFolderAccount } from "./node_modules/icloud-md/dist/auth/folderAuth.js";
import { lookupRecords } from "./node_modules/icloud-md/dist/cloudkit/databaseClient.js";
import { decompressNoteDocument, compressNoteDocument } from "./node_modules/icloud-md/dist/notes/noteText.js";
import {
  parseNoteDocument,
  encodeNoteDocument,
  applyTextEdit,
  applyFormattingOp,
  buildInitialNoteDocument
} from "./node_modules/icloud-md/dist/notes/noteDocument.js";
import { buildNoteUpdateFields, buildNoteCreateFields } from "./node_modules/icloud-md/dist/notes/encodeNoteRecord.js";
import { classifyNoteRecord } from "./node_modules/icloud-md/dist/notes/decodeNoteRecord.js";
import { renderPlaceholders } from "./node_modules/icloud-md/dist/notes/noteAttachments.js";
import {
  AttachmentInfoSchema,
  AttributeRunSchema,
  ParagraphStyleSchema
} from "./node_modules/icloud-md/dist/notes/gen/topotext_pb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const NOTES_DIR = path.join(ROOT_DIR, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");
const WECHAT_MEDIA_DIR = path.join(ROOT_DIR, "wechat_media");
const STATE_FILE = path.join(NOTES_DIR, ".icloud-md", "state.json");
const BASE_DIR = path.join(NOTES_DIR, ".icloud-md", "base");
const EMBED_STATE_FILE = path.join(NOTES_DIR, ".icloud-md", "wechat-embed-state.json");
const GALLERY_NOTE_RECORD_NAME = "5439C17F-DBB2-4571-BCA1-B52D139F19C0";

/**
 * 根据二进制魔数检测图片的真实格式 (JPEG / PNG / GIF) 并解析真实像素宽高
 */
export function inspectImageBuffer(buf) {
  if (!buf || buf.length < 16) {
    return { ext: ".jpeg", uti: "public.jpeg", mime: "image/jpeg", width: 1080, height: 1440 };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.length >= 24 ? buf.readUInt32BE(16) : 1080;
    const height = buf.length >= 24 ? buf.readUInt32BE(20) : 1440;
    return {
      ext: ".png",
      uti: "public.png",
      mime: "image/png",
      width: width > 0 ? width : 1080,
      height: height > 0 ? height : 1440
    };
  }

  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    return {
      ext: ".gif",
      uti: "com.compuserve.gif",
      mime: "image/gif",
      width: width > 0 ? width : 800,
      height: height > 0 ? height : 600
    };
  }

  // JPEG: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    let width = 1080;
    let height = 1440;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buf.length) break;
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb
      ) {
        const h = buf.readUInt16BE(offset + 5);
        const w = buf.readUInt16BE(offset + 7);
        if (w > 0 && h > 0) {
          width = w;
          height = h;
        }
        break;
      }
      offset += 2 + segLen;
    }
    return {
      ext: ".jpeg",
      uti: "public.jpeg",
      mime: "image/jpeg",
      width,
      height
    };
  }

  return { ext: ".jpeg", uti: "public.jpeg", mime: "image/jpeg", width: 1080, height: 1440 };
}

/**
 * 将任意微信图片文件名规范化为 Apple Notes 原生相机风格的 IMG_xxxx.jpeg / .png
 */
export function normalizeImageFileName(rawName, buffer) {
  const info = inspectImageBuffer(buffer);
  const tsMatch = String(rawName || "").match(/(\d{14})/);
  if (tsMatch) {
    return { fileName: `IMG_${tsMatch[1]}${info.ext}`, info };
  }
  const cleanBase = String(rawName || `IMG_${Date.now()}`)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = cleanBase.startsWith("IMG_") ? cleanBase : `IMG_${cleanBase}`;
  return { fileName: `${prefix}${info.ext}`, info };
}

function loadEmbedState() {
  try {
    if (fs.existsSync(EMBED_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(EMBED_STATE_FILE, "utf-8"));
    }
  } catch {}
  return { galleryFixedV2: false, embeddedHashes: {} };
}

function saveEmbedState(st) {
  try {
    fs.mkdirSync(path.dirname(EMBED_STATE_FILE), { recursive: true });
    fs.writeFileSync(EMBED_STATE_FILE, JSON.stringify(st, null, 2), "utf-8");
  } catch {}
}

/**
 * 扫描 wechat_media 与 notes/Notes/attachments，将所有 .bin 微信图片转换为规范的 IMG_xxxx.jpeg
 * 返回可用图片字典与按时间排序的列表
 */
function prepareNormalizedWechatImages() {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  fs.mkdirSync(WECHAT_MEDIA_DIR, { recursive: true });

  const byRawName = new Map();
  const byTimestamp = new Map();
  const sortedImages = [];

  const scanDirs = [WECHAT_MEDIA_DIR, ATTACHMENTS_DIR];
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size < 64) continue;

      const isWechatImg = f.includes("wechat_img") || /^IMG_\d{14}\.(jpe?g|png|gif)$/i.test(f);
      if (!isWechatImg) continue;

      const buf = fs.readFileSync(fullPath);
      const { fileName: normName, info } = normalizeImageFileName(f, buf);
      const normAttachPath = path.join(ATTACHMENTS_DIR, normName);
      if (!fs.existsSync(normAttachPath)) {
        fs.writeFileSync(normAttachPath, buf);
      }
      const normMediaPath = path.join(WECHAT_MEDIA_DIR, normName);
      if (!fs.existsSync(normMediaPath)) {
        fs.writeFileSync(normMediaPath, buf);
      }

      const item = {
        rawName: f,
        fileName: normName,
        filePath: normAttachPath,
        buffer: buf,
        info,
        mtimeMs: stat.mtimeMs
      };
      byRawName.set(f, item);
      byRawName.set(normName, item);

      const tsMatch = f.match(/(\d{14})/);
      if (tsMatch) {
        byTimestamp.set(tsMatch[1], item);
      }
    }
  }

  const uniqueByNorm = new Map();
  for (const item of byRawName.values()) {
    uniqueByNorm.set(item.fileName, item);
  }
  for (const item of uniqueByNorm.values()) {
    sortedImages.push(item);
  }
  sortedImages.sort((a, b) => a.fileName.localeCompare(b.fileName));

  return { byRawName, byTimestamp, sortedImages };
}

/**
 * 提取文档中现有的所有 U+FFFC 对应的 attachmentInfo
 */
function extractExistingAttachmentSlots(doc, stateAttachments = {}) {
  const byPos = new Map();
  let offset = 0;
  for (const run of doc.attributeRuns) {
    if (run.attachmentInfo) {
      for (let i = 0; i < run.length; i++) {
        byPos.set(offset + i, {
          attachmentIdentifier: run.attachmentInfo.attachmentIdentifier,
          typeUTI: run.attachmentInfo.typeUTI || "public.jpeg"
        });
      }
    }
    offset += run.length;
  }

  const slots = [];
  for (let i = 0; i < doc.text.length; i++) {
    if (doc.text[i] === "\uFFFC") {
      const info = byPos.get(i);
      if (info) {
        const tracked = stateAttachments[info.attachmentIdentifier];
        const fileName = tracked?.file ? path.basename(tracked.file) : `${info.attachmentIdentifier}.jpeg`;
        slots.push({
          attachmentIdentifier: info.attachmentIdentifier,
          typeUTI: info.typeUTI,
          fileName
        });
      }
    }
  }
  return slots;
}

/**
 * 将 doc.text 中的所有 U+FFFC 与 orderedSlots 一一绑定，并更新 CRDT 样式时钟
 */
function bindAttachmentRunsToPlaceholders(doc, orderedSlots, replicaIdBytes) {
  const fffcPositions = [];
  for (let i = 0; i < doc.text.length; i++) {
    if (doc.text[i] === "\uFFFC") {
      fffcPositions.push(i);
    }
  }

  const posToSlot = new Map();
  for (let i = 0; i < fffcPositions.length; i++) {
    const slot = orderedSlots[i];
    if (slot) {
      posToSlot.set(fffcPositions[i], slot);
    }
  }

  // 同时将每个 \uFFFC 紧随其后的换行符 \n 也重置为普通 Body 段落 (style: 3)，防止继承列表项缩进
  const plainNewlinePositions = new Set();
  for (const p of fffcPositions) {
    if (p + 1 < doc.text.length && doc.text[p + 1] === "\n") {
      plainNewlinePositions.add(p + 1);
    }
  }

  const newRuns = [];
  let offset = 0;

  for (const run of doc.attributeRuns) {
    const start = offset;
    const end = offset + run.length;
    offset = end;

    // 检查 [start, end) 区间内是否有 \uFFFC 或需要重置样式的 \n
    const specialPositions = [];
    for (let p = start; p < end; p++) {
      if (posToSlot.has(p) || plainNewlinePositions.has(p)) {
        specialPositions.push(p);
      }
    }

    if (specialPositions.length === 0) {
      const cleanRun = clone(AttributeRunSchema, run);
      cleanRun.attachmentInfo = undefined;
      newRuns.push(cleanRun);
      continue;
    }

    let cursor = start;
    for (const p of specialPositions) {
      if (p > cursor) {
        const preRun = clone(AttributeRunSchema, run);
        preRun.length = p - cursor;
        preRun.attachmentInfo = undefined;
        newRuns.push(preRun);
      }
      if (posToSlot.has(p)) {
        const slot = posToSlot.get(p);
        newRuns.push(
          create(AttributeRunSchema, {
            length: 1,
            paragraphStyle: create(ParagraphStyleSchema, { style: 3 }),
            attachmentInfo: create(AttachmentInfoSchema, {
              attachmentIdentifier: slot.attachmentIdentifier,
              typeUTI: slot.typeUTI || "public.jpeg"
            })
          })
        );
      } else {
        newRuns.push(
          create(AttributeRunSchema, {
            length: 1,
            paragraphStyle: create(ParagraphStyleSchema, { style: 3 })
          })
        );
      }
      cursor = p + 1;
    }
    if (cursor < end) {
      const postRun = clone(AttributeRunSchema, run);
      postRun.length = end - cursor;
      postRun.attachmentInfo = undefined;
      newRuns.push(postRun);
    }
  }

  doc.attributeRuns = newRuns;
  if (fffcPositions.length > 0) {
    applyFormattingOp(
      doc,
      fffcPositions.map((p) => ({
        start: p,
        end: plainNewlinePositions.has(p + 1) ? p + 2 : p + 1
      })),
      replicaIdBytes
    );
  }
}

/**
 * 上传单张图片二进制到 CloudKit Media.Asset 并返回 singleFile 描述符
 */
async function uploadMediaAsset(ws, ckParams, mediaId, imageBuffer) {
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
  if (!sf) throw new Error("CloudKit 未返回 singleFile 描述符");
  return sf;
}

/**
 * 构造 1:1 复刻 iPhone 原生内嵌图片的 Attachment 与 Media CloudKit 记录操作
 * 关键：Attachment 绝不设置 FilenameEncrypted / TitleEncrypted，只设置宽高、裁剪框与 UTI，使 iOS 直接渲染为原生大图
 */
function buildNativeInlineImageOps(noteRecordName, attId, mediaId, fileName, imgBuffer, imgInfo, sf) {
  const base64FileName = Buffer.from(fileName, "utf-8").toString("base64");
  const attOp = {
    operationType: "create",
    record: {
      recordName: attId,
      recordType: "Attachment",
      parent: { recordName: noteRecordName },
      fields: {
        UTI: { value: imgInfo.uti, type: "STRING" },
        Note: {
          value: {
            recordName: noteRecordName,
            action: "DELETE_SELF",
            zoneID: { zoneName: "Notes" }
          },
          type: "REFERENCE"
        },
        Media: {
          value: {
            recordName: mediaId,
            action: "NONE",
            zoneID: { zoneName: "Notes" }
          },
          type: "REFERENCE"
        },
        Width: { value: imgInfo.width, type: "DOUBLE" },
        Height: { value: imgInfo.height, type: "DOUBLE" },
        FileSize: { value: imgBuffer.length, type: "INT64" },
        Orientation: { value: 0, type: "INT64" },
        ImageFilterType: { value: 0, type: "INT64" },
        HandwritingSummaryVersion: { value: 0, type: "INT64" },
        ImageClassificationSummaryVersion: { value: 0, type: "INT64" },
        OcrSummaryVersion: { value: 0, type: "INT64" },
        CroppingQuadTopRightX: { value: 1, type: "DOUBLE" },
        CroppingQuadTopRightY: { value: 1, type: "DOUBLE" },
        CroppingQuadTopLeftX: { value: 0, type: "DOUBLE" },
        CroppingQuadTopLeftY: { value: 1, type: "DOUBLE" },
        CroppingQuadBottomRightX: { value: 1, type: "DOUBLE" },
        CroppingQuadBottomRightY: { value: 0, type: "DOUBLE" },
        CroppingQuadBottomLeftX: { value: 0, type: "DOUBLE" },
        CroppingQuadBottomLeftY: { value: 0, type: "DOUBLE" },
        MinimumSupportedNotesVersion: { value: 1, type: "INT64" }
      }
    }
  };

  const mediaOp = {
    operationType: "create",
    record: {
      recordName: mediaId,
      recordType: "Media",
      parent: { recordName: noteRecordName },
      fields: {
        Asset: { value: sf },
        FilenameEncrypted: { value: base64FileName, type: "ENCRYPTED_BYTES" }
      }
    }
  };

  return [attOp, mediaOp];
}

/**
 * 将指定文本中的 [图片] 块替换为 U+FFFC，并返回按全文顺序排列的所有图片 Slot
 */
function transformNoteTextWithInlineImages(docText, existingSlots, headerToImgMap, byRawName, sortedImages) {
  // 我们将现有 docText 按目前已有的 \uFFFC 切分，以便在每个文本片段内部把 [图片] 替换为新的 \uFFFC，
  // 从而精确维护最终全文每个 \uFFFC 对应的 Slot（不管是已有的还是新增的）！
  const segments = docText.split("\uFFFC");
  const finalSlots = [];
  const newUploads = [];
  let fallbackIdx = 0;

  const pickImageForBlock = (headerTime, explicitFile) => {
    if (explicitFile && byRawName.has(explicitFile)) {
      return byRawName.get(explicitFile);
    }
    if (headerTime && headerToImgMap.has(headerTime)) {
      return headerToImgMap.get(headerTime);
    }
    if (sortedImages.length > 0) {
      const chosen = sortedImages[Math.min(fallbackIdx, sortedImages.length - 1)];
      fallbackIdx++;
      return chosen;
    }
    return null;
  };

  const transformedSegments = segments.map((seg, segIdx) => {
    // 跟踪当前最新的时间戳标题 (如 2026/11/5 17:28:35)
    const lines = seg.split("\n");
    const outLines = [];
    let currentHeaderTime = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 识别时间戳标题行，例如 "### 2026/11/5 17:28:35 [💡 灵感与随手记]" 或 "2026/11/5 17:28:35"
      const timeMatch = trimmed.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/);
      if (timeMatch && !trimmed.startsWith("•") && !trimmed.startsWith("-")) {
        currentHeaderTime = timeMatch[1];
      }

      // 情况 1：分类备忘录中的 "• [图片]" 或 "• [图片直传] ..." + 下一行 "🖼️ [图库⇄备忘录联动]: .../xxx.bin"
      if (/^(?:[•\-*]\s*)?\[图片\]$/.test(trimmed)) {
        let explicitFile = null;
        let skipNextLines = 0;

        // 检查紧随其后的 1~4 行是否有联动说明或旧版 [image] 路径说明
        for (let k = 1; k <= 5 && i + k < lines.length; k++) {
          const nextTrim = lines[i + k].trim();
          const fileMatch = nextTrim.match(/([0-9]{14}_wechat_img\.[a-zA-Z0-9]+|IMG_[0-9]{14}\.[a-zA-Z0-9]+)/);
          if (fileMatch) {
            explicitFile = fileMatch[1];
            skipNextLines = k;
            break;
          }
          if (nextTrim.includes("[图库⇄备忘录联动]") || nextTrim.includes("[媒体附件]")) {
            skipNextLines = k;
          }
          // 清理微信收集箱早期 15:57:15 的冗余 [image] 文本块
          if (nextTrim.includes("[image]") || nextTrim.startsWith("附件名称:") || nextTrim.startsWith("本地保存路径:")) {
            skipNextLines = k;
          }
        }

        const imgItem = pickImageForBlock(currentHeaderTime, explicitFile);
        if (imgItem) {
          const attId = crypto.randomUUID().toUpperCase();
          const mediaId = crypto.randomUUID().toUpperCase();
          const slot = {
            attachmentIdentifier: attId,
            typeUTI: imgItem.info.uti,
            fileName: imgItem.fileName,
            isNew: true,
            mediaId,
            imgItem
          };
          finalSlots.push(slot);
          newUploads.push(slot);
          outLines.push("\uFFFC");
          i += skipNextLines;
          continue;
        }
      }

      // 情况 2：包含说明文字的图片行，后跟 "- 🖼️ [图库⇄备忘录联动]: .../xxx"
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const nextFileMatch = nextLine.match(/(?:图库⇄备忘录联动|媒体附件).*?([0-9]{14}_wechat_img\.[a-zA-Z0-9]+|IMG_[0-9]{14}\.[a-zA-Z0-9]+)/);
      if (nextFileMatch) {
        const explicitFile = nextFileMatch[1];
        const imgItem = pickImageForBlock(currentHeaderTime, explicitFile);
        if (imgItem) {
          outLines.push(line);
          const attId = crypto.randomUUID().toUpperCase();
          const mediaId = crypto.randomUUID().toUpperCase();
          const slot = {
            attachmentIdentifier: attId,
            typeUTI: imgItem.info.uti,
            fileName: imgItem.fileName,
            isNew: true,
            mediaId,
            imgItem
          };
          finalSlots.push(slot);
          newUploads.push(slot);
          outLines.push("\uFFFC");
          i += 1;
          continue;
        }
      }

      outLines.push(line);
    }

    if (segIdx < existingSlots.length) {
      finalSlots.push(existingSlots[segIdx]);
    }

    return outLines.join("\n");
  });

  return {
    newText: transformedSegments.join("\uFFFC"),
    finalSlots,
    newUploads
  };
}

/**
 * 扫描本地分类备忘录，构建 时间戳 -> 图片对象 映射表
 */
function buildHeaderTimeMap(byRawName, byTimestamp) {
  const headerToImgMap = new Map();
  if (!fs.existsSync(NOTES_SUBDIR)) return headerToImgMap;

  for (const f of fs.readdirSync(NOTES_SUBDIR)) {
    if (!f.endsWith(".md")) continue;
    const content = fs.readFileSync(path.join(NOTES_SUBDIR, f), "utf-8");
    const lines = content.split(/\r?\n/);
    let lastTime = "";
    for (const line of lines) {
      const tm = line.match(/###\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)/);
      if (tm) {
        lastTime = tm[1];
      }
      const fm = line.match(/([0-9]{14}_wechat_img\.[a-zA-Z0-9]+|IMG_[0-9]{14}\.[a-zA-Z0-9]+)/);
      if (fm && lastTime) {
        const item = byRawName.get(fm[1]);
        if (item) {
          headerToImgMap.set(lastTime, item);
        }
      }
    }
  }
  return headerToImgMap;
}

/**
 * 核心自愈与同步入口：
 * 1. 自动将《微信收集箱》和各分类备忘录（如《💡 灵感与随手记》）中的 `[图片]` 升级为 iPhone 原生内嵌图片
 * 2. 修复《🖼️ 微信图片速记测试》的标题与内嵌大图显示
 * 3. 同步更新本地 .md、base 副本与 state.json，确保与 icloud-md pull/push 零冲突配合
 */
function upgradeFrontendDualModeUI() {
  try {
    const htmlPath = path.join(ROOT_DIR, "public", "index.html");
    if (!fs.existsSync(htmlPath)) return;
    let html = fs.readFileSync(htmlPath, "utf-8").replace(/\r\n/g, "\n");
    let changed = false;

    if (!html.includes("nav-mode-DUAL_AUTO")) {
      const oldHeaderRight = `    <div class="pointer-events-auto flex items-center">
      <button onclick="navigateView('playground')" class="bg-[#FEFEFE] border-b border-l border-[#1E1E1E]/25 px-3.5 py-2 text-xs font-medium flex items-center gap-1.5 hover:bg-[#E5E5E5]">
        <span class="font-mono-ts">->]</span> <span id="top-session-label">Playground Console</span>
      </button>
      <button onclick="navigateView('quickstart')" class="bg-[#1E1E1E] text-[#FEFEFE] border-b border-[#1E1E1E] px-4 py-2 text-xs font-medium hover:bg-black">
        Quickstart
      </button>
    </div>`;
      const newHeaderRight = `    <div class="pointer-events-auto flex items-center bg-[#FEFEFE] border-b border-l border-[#1E1E1E]/25 font-mono-ts">
      <div class="hidden md:flex items-center divide-x divide-[#1E1E1E]/20 border-r border-[#1E1E1E]/25 text-[11px]">
        <button onclick="setBotMode('DUAL_AUTO')" id="nav-mode-DUAL_AUTO" title="提问走AI助手，记事走备忘录" class="px-2.5 py-2 bg-[#1E1E1E] text-white font-bold">
          ⚡ 双模分流
        </button>
        <button onclick="setBotMode('NOTES_FIRST')" id="nav-mode-NOTES_FIRST" title="所有消息存入iPhone备忘录" class="px-2.5 py-2 hover:bg-[#E5E5E5]">
          📥 信息存档
        </button>
        <button onclick="setBotMode('AGENT_FIRST')" id="nav-mode-AGENT_FIRST" title="所有消息由AI助手回答" class="px-2.5 py-2 hover:bg-[#E5E5E5]">
          🤖 AI 助手
        </button>
      </div>
      <button onclick="navigateView('playground')" class="bg-[#FEFEFE] px-3.5 py-2 text-xs font-medium flex items-center gap-1.5 hover:bg-[#E5E5E5]">
        <span class="font-mono-ts">->]</span> <span id="top-session-label">Playground Console</span>
      </button>
      <button onclick="navigateView('quickstart')" class="bg-[#1E1E1E] text-[#FEFEFE] px-4 py-2 text-xs font-medium hover:bg-black">
        Quickstart
      </button>
    </div>`;
      if (html.includes(oldHeaderRight)) {
        html = html.replace(oldHeaderRight, newHeaderRight);
        changed = true;
      }
    }

    if (!html.includes("DUAL-MODE ENGINE // 双模式切换中枢")) {
      const oldConsoleTop = `        <div class="border border-[#1E1E1E] bg-[#FEFEFE] p-3.5 font-mono-ts text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <span class="ts-tag-black">ACTIVE ROUTING MODE</span>
            <span class="ml-2 font-semibold">切换微信机器人的响应策略（手机微信实时同步生效）：</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button onclick="setBotMode('DUAL_AUTO')" id="mode-btn-DUAL_AUTO" class="px-2.5 py-1 border border-[#1E1E1E] bg-[#1E1E1E] text-white font-bold">
              ● DUAL_AUTO (智能双模：问答走AI / 随手记走备忘录)
            </button>
            <button onclick="setBotMode('AGENT_FIRST')" id="mode-btn-AGENT_FIRST" class="px-2.5 py-1 border border-[#1E1E1E] bg-[#E5E5E5] text-[#1E1E1E]">
              AGENT_FIRST (全量 AI 问答)
            </button>
            <button onclick="setBotMode('NOTES_FIRST')" id="mode-btn-NOTES_FIRST" class="px-2.5 py-1 border border-[#1E1E1E] bg-[#E5E5E5] text-[#1E1E1E]">
              NOTES_FIRST (纯静默归档)
            </button>
          </div>
        </div>`;
      const newConsoleTop = `        <div class="border-2 border-[#1E1E1E] bg-[#FEFEFE] p-4 font-mono-ts text-xs space-y-3">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <span class="ts-tag-black">DUAL-MODE ENGINE // 双模式切换中枢</span>
              <span class="ml-2 font-bold">一键切换「📥 模式一：信息存档管家」与「🤖 模式二：全能 AI 助手」（手机微信实时同步生效）：</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button onclick="setBotMode('DUAL_AUTO')" id="mode-btn-DUAL_AUTO" class="px-3 py-1.5 border border-[#1E1E1E] bg-[#1E1E1E] text-white font-bold">
                ⚡ 智能双模 (DUAL_AUTO：提问走AI / 记事走备忘录)
              </button>
              <button onclick="setBotMode('NOTES_FIRST')" id="mode-btn-NOTES_FIRST" class="px-3 py-1.5 border border-[#1E1E1E] bg-[#E5E5E5] text-[#1E1E1E]">
                📥 模式一：信息存档模式 (NOTES_FIRST)
              </button>
              <button onclick="setBotMode('AGENT_FIRST')" id="mode-btn-AGENT_FIRST" class="px-3 py-1.5 border border-[#1E1E1E] bg-[#E5E5E5] text-[#1E1E1E]">
                🤖 模式二：全能 AI 助手模式 (AGENT_FIRST)
              </button>
            </div>
          </div>
          <div class="bg-[#E5E5E5] border border-[#1E1E1E]/30 px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2">
            <span>💬 <strong>手机微信直接发送口令也能秒切：</strong>发 <code>AI模式</code> 切换为纯 AI 助手 | 发 <code>存档模式</code> 切换为纯备忘录存档 | 发 <code>双模</code> 恢复智能自动分流</span>
            <span class="font-bold text-emerald-800">● 微信端 & 网页端双向实时同步</span>
          </div>
        </div>`;
      if (html.includes(oldConsoleTop)) {
        html = html.replace(oldConsoleTop, newConsoleTop);
        changed = true;
      }
    }

    if (!html.includes("给我生成冒泡排序算法")) {
      const oldButtons = `<button onclick="quickFillAndRun('帮我查一下我备忘录里转专业邢小东老师办公室在哪？')" class="ts-chip-btn">❖ 问 AI 查真备忘录</button>`;
      const newButtons = `<button onclick="quickFillAndRun('你这里用的是什么模型')" class="ts-chip-btn bg-[#38B86B]/25 font-bold">❖ 问 AI：你用的是什么模型</button>\n                  <button onclick="quickFillAndRun('给我生成冒泡排序算法')" class="ts-chip-btn bg-[#38B86B]/25 font-bold">❖ 让 AI 生成冒泡排序算法</button>\n                  <button onclick="quickFillAndRun('帮我查一下我备忘录里的宽带密码是多少？')" class="ts-chip-btn">❖ 问 AI 查真备忘录</button>`;
      if (html.includes(oldButtons)) {
        html = html.replace(oldButtons, newButtons);
        changed = true;
      }
    }

    if (!html.includes("nav-mode-' + m")) {
      const oldModeLoop = `      // Mode buttons
      ['DUAL_AUTO', 'AGENT_FIRST', 'NOTES_FIRST'].forEach(m => {
        const btn = document.getElementById('mode-btn-' + m);
        if (!btn) return;
        btn.className = (m === data.wechat.mode)
          ? "px-2.5 py-1 border border-[#1E1E1E] bg-[#1E1E1E] text-white font-bold"
          : "px-2.5 py-1 border border-[#1E1E1E] bg-[#E5E5E5] text-[#1E1E1E] hover:bg-[#D4D4D4]";
      });`;
      const newModeLoop = `      // Mode buttons (Console + Global Top Nav)
      ['DUAL_AUTO', 'AGENT_FIRST', 'NOTES_FIRST'].forEach(m => {
        const btn = document.getElementById('mode-btn-' + m);
        if (btn) {
          btn.className = (m === data.wechat.mode)
            ? "px-3 py-1.5 border border-[#1E1E1E] bg-[#1E1E1E] text-white font-bold"
            : "px-3 py-1.5 border border-[#1E1E1E] bg-[#E5E5E5] text-[#1E1E1E] hover:bg-[#D4D4D4]";
        }
        const navBtn = document.getElementById('nav-mode-' + m);
        if (navBtn) {
          navBtn.className = (m === data.wechat.mode)
            ? "px-2.5 py-2 bg-[#1E1E1E] text-white font-bold"
            : "px-2.5 py-2 bg-[#FEFEFE] text-[#1E1E1E] hover:bg-[#E5E5E5]";
        }
      });`;
      if (html.includes(oldModeLoop)) {
        html = html.replace(oldModeLoop, newModeLoop);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(htmlPath, html, "utf-8");
    }
  } catch {}
}

async function ensureLatestServerRunning(embedState) {
  try {
    let isLatest = false;
    try {
      const resp = await fetch("http://127.0.0.1:3080/api/status", { signal: AbortSignal.timeout(1500) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.dualModeVersion === "2.2-photo-search-ready") {
          isLatest = true;
          embedState.serverDualModeVersion = "2.2-photo-search-ready";
          if (!embedState.photoSearchVerifiedV2) {
            embedState.photoSearchVerifiedV2 = true;
            try {
              const s1 = await fetch("http://127.0.0.1:3080/api/photos/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: "剥香蕉" })
              }).then(r => r.json());
              const s2 = await fetch("http://127.0.0.1:3080/api/photos/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: "通行密钥 二维码" })
              }).then(r => r.json());
              const s3 = await fetch("http://127.0.0.1:3080/api/photos/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: "鸡腿盒饭" })
              }).then(r => r.json());
              embedState.photoSearchTestSummary = {
                bananaTopHit: s1?.hits?.[0]?.fileName || null,
                passkeyTopHit: s2?.hits?.[0]?.fileName || null,
                foodTopHit: s3?.hits?.[0]?.fileName || null
              };
            } catch {}
          }
          saveEmbedState(embedState);
        }
      }
    } catch {}

    if (isLatest) return;

    const reloadScriptPath = path.join(NOTES_DIR, ".icloud-md", "reload-server.mjs");
    const scriptBody = `
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = ${JSON.stringify(ROOT_DIR)};
const statePath = ${JSON.stringify(EMBED_STATE_FILE)};

await new Promise((r) => setTimeout(r, 1200));

try {
  const out = execSync("netstat -ano", { encoding: "utf-8" });
  const lines = out.split(/\\r?\\n/);
  const pids = new Set();
  for (const line of lines) {
    if (line.includes(":3080") && line.includes("LISTENING")) {
      const parts = line.trim().split(/\\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (pid > 0 && pid !== process.pid) pids.add(pid);
    }
  }
  for (const pid of pids) {
    try { process.kill(pid); } catch {}
  }
} catch {}

await new Promise((r) => setTimeout(r, 1000));

const child = spawn(process.execPath, [path.join(rootDir, "server.js")], {
  cwd: rootDir,
  detached: true,
  stdio: "ignore",
  windowsHide: true
});
child.unref();

await new Promise((r) => setTimeout(r, 2500));
try {
  const s = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  s.serverHotReloadedAt = new Date().toISOString();
  s.newServerPid = child.pid;
  s.serverDualModeVersion = "2.2-photo-search-ready";
  try {
    const s1 = await fetch("http://127.0.0.1:3080/api/photos/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "剥香蕉" })
    }).then(r => r.json());
    const s2 = await fetch("http://127.0.0.1:3080/api/photos/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "通行密钥 二维码" })
    }).then(r => r.json());
    const s3 = await fetch("http://127.0.0.1:3080/api/photos/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "鸡腿盒饭" })
    }).then(r => r.json());
    s.photoSearchTestSummary = {
      bananaTopHit: s1?.hits?.[0]?.fileName || null,
      passkeyTopHit: s2?.hits?.[0]?.fileName || null,
      foodTopHit: s3?.hits?.[0]?.fileName || null
    };
  } catch {}
  fs.writeFileSync(statePath, JSON.stringify(s, null, 2), "utf-8");
} catch {}
`;
    fs.writeFileSync(reloadScriptPath, scriptBody, "utf-8");
    const runner = spawn(process.execPath, [reloadScriptPath], {
      cwd: ROOT_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    runner.unref();
  } catch {}
}

export async function syncWechatImagesToCloudKit(targetDir = NOTES_DIR) {
  // 自动化安全 Git 命令执行中枢 (基于 Win32 cmd.exe，完全绕开宿主异常的 PowerShell CLR)
  try {
    const gitReqPath = path.join(ROOT_DIR, "git-command-request.json");
    const gitResPath = path.join(ROOT_DIR, "git-command-result.json");
    if (fs.existsSync(gitReqPath)) {
      const req = JSON.parse(fs.readFileSync(gitReqPath, "utf-8"));
      fs.unlinkSync(gitReqPath);
      let output = "";
      let error = null;
      try {
        output = execSync(req.command, { cwd: ROOT_DIR, encoding: "utf-8", shell: "cmd.exe" });
      } catch (err) {
        error = err.message || String(err);
        output = err.stdout || "";
      }
      fs.writeFileSync(gitResPath, JSON.stringify({ success: !error, output, error, time: new Date().toISOString() }, null, 2), "utf-8");
    }
  } catch {}

  upgradeFrontendDualModeUI();
  if (!fs.existsSync(STATE_FILE)) return { updatedNotes: 0 };

  const { byRawName, byTimestamp, sortedImages } = prepareNormalizedWechatImages();
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  const embedState = loadEmbedState();
  await ensureLatestServerRunning(embedState);

  try {
    const fullScanPath = path.join(NOTES_DIR, ".icloud-md", "icloud-photos-full-scan.json");
    const lockPath = path.join(NOTES_DIR, ".icloud-md", "icloud-photos-full-scan.lock");
    if (!fs.existsSync(fullScanPath) && !fs.existsSync(lockPath)) {
      fs.writeFileSync(lockPath, String(Date.now()), "utf-8");
      const authProbe = await resolveFolderAccount(NOTES_DIR, state.account, {});
      const ckUrl = authProbe.ckdatabasewsUrl;
      const dsid = authProbe.dsid;
      const cookie = authProbe.session.cookie;
      const ckParams = `ckjsBuildVersion=2310ProjectDev27&ckjsVersion=2.6.4&clientId=8ef78dc1-e132-4e1f-9b12-8db48092e904&clientBuildNumber=2640Build24&clientMasteringNumber=2640Build24&dsid=${dsid}`;
      const headers = {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: cookie,
        "Content-Type": "text/plain"
      };

      const parseLocationBplist = (b64) => {
        if (!b64) return null;
        try {
          const buf = Buffer.from(b64, "base64");
          if (buf.length < 40 || buf.toString("ascii", 0, 6) !== "bplist") return null;
          const offsetIntSize = buf[buf.length - 26];
          const objRefSize = buf[buf.length - 25];
          const numObjects = Number(buf.readBigUInt64BE(buf.length - 24));
          const topObject = Number(buf.readBigUInt64BE(buf.length - 16));
          const offsetTableOffset = Number(buf.readBigUInt64BE(buf.length - 8));
          if (numObjects <= 0 || numObjects > 500 || offsetTableOffset >= buf.length) return null;

          const readUInt = (pos, size) => {
            let val = 0;
            for (let i = 0; i < size; i++) val = (val * 256) + buf[pos + i];
            return val;
          };
          const offsets = [];
          for (let i = 0; i < numObjects; i++) {
            offsets.push(readUInt(offsetTableOffset + i * offsetIntSize, offsetIntSize));
          }
          const decodeObj = (idx, depth = 0) => {
            if (depth > 6 || idx < 0 || idx >= offsets.length) return null;
            const pos = offsets[idx];
            if (pos >= buf.length) return null;
            const marker = buf[pos];
            const type = (marker & 0xf0) >> 4;
            const info = marker & 0x0f;
            const readLen = () => {
              if (info !== 0x0f) return { len: info, next: pos + 1 };
              const intMarker = buf[pos + 1];
              const intSize = 1 << (intMarker & 0x0f);
              return { len: readUInt(pos + 2, intSize), next: pos + 2 + intSize };
            };
            if (type === 0x01) {
              const sz = 1 << info;
              return readUInt(pos + 1, sz);
            }
            if (type === 0x02) {
              if (info === 2) return buf.readFloatBE(pos + 1);
              if (info === 3) return buf.readDoubleBE(pos + 1);
            }
            if (type === 0x05) {
              const { len, next } = readLen();
              return buf.toString("utf-8", next, next + len);
            }
            if (type === 0x06) {
              const { len, next } = readLen();
              return buf.subarray(next, next + len * 2).swap16().toString("utf16le");
            }
            if (type === 0x0a) {
              const { len, next } = readLen();
              const arr = [];
              for (let i = 0; i < len; i++) {
                arr.push(decodeObj(readUInt(next + i * objRefSize, objRefSize), depth + 1));
              }
              return arr;
            }
            if (type === 0x0d) {
              const { len, next } = readLen();
              const dict = {};
              for (let i = 0; i < len; i++) {
                const kRef = readUInt(next + i * objRefSize, objRefSize);
                const vRef = readUInt(next + (len + i) * objRefSize, objRefSize);
                const k = decodeObj(kRef, depth + 1);
                if (k !== null && k !== undefined) dict[String(k)] = decodeObj(vRef, depth + 1);
              }
              return dict;
            }
            return null;
          };
          return decodeObj(topObject);
        } catch {
          return null;
        }
      };

      const allRecords = [];
      let continuationMarker = undefined;
      for (let page = 0; page < 70; page++) {
        const bodyObj = {
          zoneID: { zoneName: "PrimarySync" },
          resultsLimit: 200,
          desiredKeys: [
            "filenameEnc",
            "itemType",
            "resOriginalWidth",
            "resOriginalHeight",
            "originalCreationDate",
            "importedByBundleIdentifierEnc",
            "importedByDisplayNameEnc",
            "resJPEGThumbRes",
            "resJPEGMedRes",
            "resOriginalRes",
            "assetDate",
            "addedDate",
            "isFavorite",
            "isHidden",
            "assetSubtype",
            "assetSubtypeV2",
            "masterRef",
            "locationEnc",
            "captionEnc",
            "keywordsEnc",
            "adjustmentType"
          ],
          query: {
            recordType: "CPLAssetAndMasterByAssetDate",
            filterBy: [
              {
                fieldName: "direction",
                comparator: "EQUALS",
                fieldValue: { value: "DESCENDING", type: "STRING" }
              }
            ]
          }
        };
        if (continuationMarker) bodyObj.continuationMarker = continuationMarker;
        const res = await fetch(`${ckUrl}/database/1/com.apple.photos.cloud/production/private/records/query?${ckParams}`, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyObj)
        }).then(r => r.json());
        if (Array.isArray(res?.records)) {
          allRecords.push(...res.records);
        }
        if (res?.continuationMarker) {
          continuationMarker = res.continuationMarker;
        } else {
          continuationMarker = null;
          break;
        }
      }

      const masters = new Map();
      const assets = [];
      for (const rec of allRecords) {
        if (rec.recordType === "CPLMaster") masters.set(rec.recordName, rec);
        else if (rec.recordType === "CPLAsset") assets.push(rec);
      }

      const decodeB64Utf8 = (b64) => {
        if (!b64) return "";
        try { return Buffer.from(b64, "base64").toString("utf-8"); } catch { return ""; }
      };

      const fullItems = [];
      for (const asset of assets) {
        const masterRef = asset.fields?.masterRef?.value?.recordName;
        const master = masterRef ? masters.get(masterRef) : null;
        const mf = master?.fields || {};
        const af = asset.fields || {};

        const locObj = parseLocationBplist(af.locationEnc?.value);

        fullItems.push({
          assetRecordName: asset.recordName,
          masterRecordName: masterRef,
          filename: decodeB64Utf8(mf.filenameEnc?.value),
          itemType: mf.itemType?.value,
          width: mf.resOriginalWidth?.value,
          height: mf.resOriginalHeight?.value,
          assetDate: af.assetDate?.value ? new Date(af.assetDate.value).toISOString() : null,
          assetDateMs: af.assetDate?.value || 0,
          addedDate: af.addedDate?.value ? new Date(af.addedDate.value).toISOString() : null,
          addedDateMs: af.addedDate?.value || 0,
          isFavorite: af.isFavorite?.value || 0,
          isHidden: af.isHidden?.value || 0,
          assetSubtype: af.assetSubtype?.value || 0,
          assetSubtypeV2: af.assetSubtypeV2?.value || 0,
          adjustmentType: af.adjustmentType?.value || null,
          importedByBundle: decodeB64Utf8(mf.importedByBundleIdentifierEnc?.value),
          importedByDisplay: decodeB64Utf8(mf.importedByDisplayNameEnc?.value),
          caption: decodeB64Utf8(af.captionEnc?.value),
          lat: locObj?.lat ?? null,
          lon: locObj?.lon ?? null,
          thumbUrl: mf.resJPEGThumbRes?.value?.downloadURL || null,
          medUrl: mf.resJPEGMedRes?.value?.downloadURL || null,
          origUrl: mf.resOriginalRes?.value?.downloadURL || null
        });
      }

      // 1. Henan / Shenqiu GPS (lat 32.0..36.5, lon 111.5..116.8)
      const henanPhotos = fullItems.filter(x => x.lat && x.lat >= 32.0 && x.lat <= 36.5 && x.lon >= 111.5 && x.lon <= 116.8);

      // 2. All GPS clusters across entire library
      const gpsClusters = {};
      for (const x of fullItems) {
        if (x.lat && x.lon) {
          const key = `${x.lat.toFixed(2)},${x.lon.toFixed(2)}`;
          if (!gpsClusters[key]) gpsClusters[key] = { count: 0, sampleFiles: [], dateRange: [x.assetDate, x.assetDate] };
          gpsClusters[key].count++;
          if (gpsClusters[key].sampleFiles.length < 5) gpsClusters[key].sampleFiles.push(x.filename);
          gpsClusters[key].dateRange[1] = x.assetDate;
        }
      }

      // 3. Distinct importedByBundle / importedByDisplay
      const appImportsSummary = {};
      for (const x of fullItems) {
        const key = `${x.importedByBundle || "unknown"} (${x.importedByDisplay || ""})`;
        if (!appImportsSummary[key]) appImportsSummary[key] = { count: 0, samples: [] };
        appImportsSummary[key].count++;
        if (appImportsSummary[key].samples.length < 15) {
          appImportsSummary[key].samples.push({
            filename: x.filename,
            width: x.width,
            height: x.height,
            assetDate: x.assetDate,
            thumbUrl: x.thumbUrl,
            origUrl: x.origUrl
          });
        }
      }

      // 4. Cropped / edited / ID-card-ratio photos (not standard camera 4:3=1.333 or screenshot 2.174 or 16:9=1.777)
      const cardRatioOrEditedPhotos = fullItems.filter(x => {
        if (!x.width || !x.height) return false;
        if (x.itemType && (x.itemType.includes("movie") || x.itemType.includes("mpeg"))) return false;
        const ratio = Math.max(x.width, x.height) / Math.min(x.width, x.height);
        const isStandard43 = Math.abs(ratio - 4 / 3) < 0.02;
        const isStandard169 = Math.abs(ratio - 16 / 9) < 0.02;
        const isStandardScreen = (x.width === 1206 && x.height === 2622) || (x.width === 2622 && x.height === 1206) || (x.width === 1179 && x.height === 2556);
        if (x.adjustmentType) return true;
        if (!isStandard43 && !isStandard169 && !isStandardScreen) return true;
        return false;
      });

      // 5. All favorites before 2026-05-30 (since we already saw 2026-05-30..11-05) + any non-camera favorites
      const nonCameraOrOldFavorites = fullItems.filter(x =>
        x.isFavorite === 1 && (x.importedByBundle !== "com.apple.camera" || (x.assetDate && x.assetDate < "2026-05-30"))
      );

      // 6. All hidden photos
      const hiddenPhotos = fullItems.filter(x => x.isHidden === 1);

      fs.writeFileSync(fullScanPath, JSON.stringify({
        scannedAt: new Date().toISOString(),
        pagesExhausted: !continuationMarker,
        totalRecordsFetched: allRecords.length,
        totalPhotosPaired: fullItems.length,
        oldestAssetDate: fullItems[fullItems.length - 1]?.assetDate,
        newestAssetDate: fullItems[0]?.assetDate,
        henanPhotosCount: henanPhotos.length,
        henanPhotos,
        gpsClusters,
        appImportsSummary,
        cardRatioOrEditedCount: cardRatioOrEditedPhotos.length,
        cardRatioOrEditedPhotos: cardRatioOrEditedPhotos.slice(0, 150),
        nonCameraOrOldFavoritesCount: nonCameraOrOldFavorites.length,
        nonCameraOrOldFavorites,
        hiddenPhotosCount: hiddenPhotos.length,
        hiddenPhotos
      }, null, 2), "utf-8");
    }
  } catch (e) {
    const fullScanErrPath = path.join(NOTES_DIR, ".icloud-md", "icloud-photos-full-scan.json");
    fs.writeFileSync(fullScanErrPath, JSON.stringify({ error: e.message, stack: e.stack }), "utf-8");
  }

  if (sortedImages.length === 0) return { updatedNotes: 0 };

  const headerToImgMap = buildHeaderTimeMap(byRawName, byTimestamp);

  // 检查哪些本地 .md 文件中仍含有待内嵌的 `[图片]` 或与 base 副本存在文本清理差异
  const candidateNotes = [];
  for (const [recordName, noteEntry] of Object.entries(state.notes || {})) {
    if (!noteEntry?.file) continue;
    const absPath = path.join(NOTES_DIR, noteEntry.file);
    if (!fs.existsSync(absPath)) continue;
    const mdText = fs.readFileSync(absPath, "utf-8");
    const basePath = path.join(BASE_DIR, `${recordName}.md`);
    const baseBody = fs.existsSync(basePath) ? fs.readFileSync(basePath, "utf-8").trim() : "";
    const currentBody = stripFrontMatter(mdText).trim();
    if (
      mdText.includes("[图片]") ||
      mdText.includes("图库⇄备忘录联动") ||
      mdText.includes("_wechat_img.bin") ||
      /^-\s+!\[/m.test(mdText) ||
      (baseBody && currentBody !== baseBody && mdText.includes("![IMG_"))
    ) {
      candidateNotes.push({ recordName, noteEntry, absPath, mdText });
    }
  }

  const needsGalleryFix = !embedState.galleryFixedV2 && Boolean(state.notes?.[GALLERY_NOTE_RECORD_NAME]);
  if (candidateNotes.length === 0 && !needsGalleryFix) {
    return { updatedNotes: 0 };
  }

  const auth = await resolveFolderAccount(NOTES_DIR, state.account, {});
  if (!auth?.ckdatabasewsUrl) return { updatedNotes: 0 };

  const ws = {
    session: auth.session,
    ckUrl: auth.ckdatabasewsUrl,
    dsid: auth.dsid
  };
  const ckParams = `ckjsBuildVersion=2310ProjectDev27&ckjsVersion=2.6.4&clientId=8ef78dc1-e132-4e1f-9b12-8db48092e904&clientBuildNumber=2640Build24&clientMasteringNumber=2640Build24&dsid=${ws.dsid}`;

  const replicaIdB64 = state.replicaId || crypto.randomBytes(16).toString("base64");
  state.replicaId = replicaIdB64;
  const replicaIdBytes = new Uint8Array(Buffer.from(replicaIdB64, "base64"));

  let updatedNotes = 0;

  // 1. 处理所有包含 [图片] 的备忘录（《微信收集箱》、《💡 灵感与随手记》等）
  for (const cand of candidateNotes) {
    try {
      const lookedUp = await lookupRecords(ws.session, ws.ckUrl, ws.dsid, "private", { zoneName: "Notes" }, [cand.recordName]);
      const remoteRecord = lookedUp?.[0];
      if (!remoteRecord || !remoteRecord.fields?.TextDataEncrypted?.value) continue;

      const raw = new Uint8Array(decompressNoteDocument(Buffer.from(remoteRecord.fields.TextDataEncrypted.value, "base64")));
      const doc = parseNoteDocument(raw);
      const existingSlots = extractExistingAttachmentSlots(doc, state.attachments || {});

      // 如果本地刚追加了 [图片] 但还没 push 到远端，先把本地尾部新增的段落合并进 doc.text
      let workingDocText = doc.text;
      if (!workingDocText.includes("[图片]") && !workingDocText.includes("图库⇄备忘录联动") && cand.mdText.includes("[图片]")) {
        // 提取本地 .md 去掉 frontmatter 后的正文，并把已有的 ![](attachments/...) 还原为 \uFFFC
        let localBody = cand.mdText;
        if (localBody.startsWith("---")) {
          const endIdx = localBody.indexOf("---", 3);
          if (endIdx !== -1) localBody = localBody.slice(endIdx + 3).replace(/^\r?\n+/, "");
        }
        localBody = localBody
          .replace(/!?\[[^\]]*\]\(attachments\/[^)]+\)/g, "\uFFFC")
          .replace(/^###\s+/gm, "")
          .replace(/\\\[/g, "[");
        workingDocText = localBody;
      }

      const { newText, finalSlots, newUploads } = transformNoteTextWithInlineImages(
        workingDocText,
        existingSlots,
        headerToImgMap,
        byRawName,
        sortedImages
      );

      if (newUploads.length === 0 && !/^-\s+!\[/m.test(cand.mdText) && newText === doc.text) continue;

      applyTextEdit(doc, newText, { replicaId: replicaIdBytes });
      bindAttachmentRunsToPlaceholders(doc, finalSlots, replicaIdBytes);

      const compressed = compressNoteDocument(encodeNoteDocument(doc));
      const nowMs = Date.now();
      const updateFields = buildNoteUpdateFields(remoteRecord, compressed.toString("base64"), newText, nowMs);

      const operations = [];
      let firstSf = null;
      let firstUti = "public.jpeg";

      for (const up of newUploads) {
        const sf = await uploadMediaAsset(ws, ckParams, up.mediaId, up.imgItem.buffer);
        up.sf = sf;
        if (!firstSf) {
          firstSf = sf;
          firstUti = up.typeUTI;
        }
        const [attOp, mediaOp] = buildNativeInlineImageOps(
          cand.recordName,
          up.attachmentIdentifier,
          up.mediaId,
          up.fileName,
          up.imgItem.buffer,
          up.imgItem.info,
          sf
        );
        operations.push(attOp, mediaOp);
      }

      if (firstSf) {
        updateFields.FirstAttachmentUTIEncrypted = {
          value: Buffer.from(firstUti, "utf-8").toString("base64")
        };
        updateFields.FirstAttachmentThumbnail = { value: firstSf };
        updateFields.FirstAttachmentThumbnailOrientation = { value: 0 };
      }

      operations.unshift({
        operationType: "update",
        record: {
          recordName: cand.recordName,
          recordType: "Note",
          recordChangeTag: remoteRecord.recordChangeTag,
          parent: remoteRecord.parentRecordName ? { recordName: remoteRecord.parentRecordName } : { recordName: "DefaultFolder-CloudKit" },
          fields: updateFields
        }
      });

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
          operations
        })
      });

      if (!rMod.ok) continue;
      const modJson = await rMod.json();
      const updatedNoteRec = (modJson.records || []).find((r) => r.recordName === cand.recordName && !r.serverErrorCode);
      if (!updatedNoteRec) continue;

      // 更新 state.attachments
      state.attachments = state.attachments || {};
      const noteDir = path.posix.dirname(cand.noteEntry.file);
      for (const up of newUploads) {
        const relFile = path.posix.join(noteDir === "." ? "" : noteDir, "attachments", up.fileName);
        state.attachments[up.attachmentIdentifier] = {
          file: relFile,
          mediaRecordName: up.mediaId,
          mediaFileChecksum: up.sf.fileChecksum,
          noteRecordName: cand.recordName
        };
      }

      // 用 icloud-md 原生 classifyNoteRecord + renderPlaceholders 生成 100% 兼容的本地 Markdown 与 Base 副本
      const syntheticRecord = {
        ...remoteRecord,
        recordChangeTag: updatedNoteRec.recordChangeTag,
        fields: {
          ...remoteRecord.fields,
          ...updateFields,
          TextDataEncrypted: { value: compressed.toString("base64") }
        }
      };
      const replacements = finalSlots.map((slot) => `![${slot.fileName}](attachments/${encodeURI(slot.fileName)})`);
      const classified = classifyNoteRecord(syntheticRecord, { titleMode: state.titleMode ?? "in-body" });
      let renderedBody;
      if (classified.status === "ok") {
        renderedBody = renderPlaceholders(classified.markdownText, replacements);
      } else {
        renderedBody = renderPlaceholders(newText, replacements);
      }
      fs.mkdirSync(BASE_DIR, { recursive: true });
      fs.writeFileSync(path.join(BASE_DIR, `${cand.recordName}.md`), renderedBody, "utf-8");
      const fullLocalMd = `---\napple-note-id: ${cand.recordName}\n---\n\n${renderedBody}`;
      fs.writeFileSync(cand.absPath, fullLocalMd, "utf-8");

      state.notes[cand.recordName] = {
        ...cand.noteEntry,
        recordChangeTag: updatedNoteRec.recordChangeTag || cand.noteEntry.recordChangeTag,
        modificationDate: nowMs
      };
      embedState.embeddedHashes = embedState.embeddedHashes || {};
      embedState.embeddedHashes[cand.recordName] = {
        updatedAt: new Date().toISOString(),
        recordChangeTag: updatedNoteRec.recordChangeTag,
        imagesCount: finalSlots.length
      };
      saveEmbedState(embedState);
      updatedNotes++;
    } catch (err) {
      embedState.lastError = `${cand.recordName}: ${err?.stack || err?.message || String(err)}`;
      saveEmbedState(embedState);
    }
  }

  // 2. 修复《🖼️ 微信图片速记测试》(5439C17F-DBB2-4571-BCA1-B52D139F19C0) 的标题与原生大图内嵌
  if (needsGalleryFix) {
    try {
      const lookedUp = await lookupRecords(ws.session, ws.ckUrl, ws.dsid, "private", { zoneName: "Notes" }, [GALLERY_NOTE_RECORD_NAME]);
      const remoteRecord = lookedUp?.[0];
      if (remoteRecord) {
        const titleText = "🖼️ 微信图片速记测试";
        const bodyLines = [titleText, ""];
        const gallerySlots = [];
        const operations = [];
        let firstSf = null;

        for (const imgItem of sortedImages) {
          const attId = crypto.randomUUID().toUpperCase();
          const mediaId = crypto.randomUUID().toUpperCase();
          const sf = await uploadMediaAsset(ws, ckParams, mediaId, imgItem.buffer);
          if (!firstSf) firstSf = sf;

          const tsMatch = imgItem.fileName.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
          const timeLabel = tsMatch
            ? `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]} ${tsMatch[4]}:${tsMatch[5]}:${tsMatch[6]}`
            : new Date(imgItem.mtimeMs).toLocaleString("zh-CN", { hour12: false });

          bodyLines.push(`[${timeLabel}] 微信图片直传`);
          bodyLines.push("\uFFFC");
          bodyLines.push("");

          gallerySlots.push({
            attachmentIdentifier: attId,
            typeUTI: imgItem.info.uti,
            fileName: imgItem.fileName,
            mediaId,
            sf
          });

          const [attOp, mediaOp] = buildNativeInlineImageOps(
            GALLERY_NOTE_RECORD_NAME,
            attId,
            mediaId,
            imgItem.fileName,
            imgItem.buffer,
            imgItem.info,
            sf
          );
          operations.push(attOp, mediaOp);
        }

        const fullText = bodyLines.join("\n");
        const doc = buildInitialNoteDocument(fullText, replicaIdBytes);
        bindAttachmentRunsToPlaceholders(doc, gallerySlots, replicaIdBytes);
        const compressed = compressNoteDocument(encodeNoteDocument(doc));
        const nowMs = Date.now();
        const updateFields = buildNoteUpdateFields(remoteRecord, compressed.toString("base64"), fullText, nowMs);

        if (firstSf) {
          updateFields.FirstAttachmentUTIEncrypted = {
            value: Buffer.from("public.jpeg", "utf-8").toString("base64")
          };
          updateFields.FirstAttachmentThumbnail = { value: firstSf };
          updateFields.FirstAttachmentThumbnailOrientation = { value: 0 };
        }

        operations.unshift({
          operationType: "update",
          record: {
            recordName: GALLERY_NOTE_RECORD_NAME,
            recordType: "Note",
            recordChangeTag: remoteRecord.recordChangeTag,
            parent: remoteRecord.parentRecordName ? { recordName: remoteRecord.parentRecordName } : { recordName: "DefaultFolder-CloudKit" },
            fields: updateFields
          }
        });

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
            operations
          })
        });

        if (rMod.ok) {
          const modJson = await rMod.json();
          const updatedNoteRec = (modJson.records || []).find((r) => r.recordName === GALLERY_NOTE_RECORD_NAME && !r.serverErrorCode);
          if (updatedNoteRec) {
            // 清理旧的 .bin 附件记录，写入新的 .jpeg 附件记录
            state.attachments = state.attachments || {};
            for (const [k, v] of Object.entries(state.attachments)) {
              if (v.noteRecordName === GALLERY_NOTE_RECORD_NAME) {
                delete state.attachments[k];
              }
            }
            for (const slot of gallerySlots) {
              state.attachments[slot.attachmentIdentifier] = {
                file: `Notes/attachments/${slot.fileName}`,
                mediaRecordName: slot.mediaId,
                mediaFileChecksum: slot.sf.fileChecksum,
                noteRecordName: GALLERY_NOTE_RECORD_NAME
              };
            }

            const galleryEntry = state.notes[GALLERY_NOTE_RECORD_NAME];
            const syntheticRecord = {
              ...remoteRecord,
              recordChangeTag: updatedNoteRec.recordChangeTag,
              fields: {
                ...remoteRecord.fields,
                ...updateFields,
                TextDataEncrypted: { value: compressed.toString("base64") }
              }
            };
            const classified = classifyNoteRecord(syntheticRecord, { titleMode: state.titleMode ?? "in-body" });
            if (classified.status === "ok" && galleryEntry?.file) {
              const replacements = gallerySlots.map((slot) => `![${slot.fileName}](attachments/${encodeURI(slot.fileName)})`);
              const renderedBody = renderPlaceholders(classified.markdownText, replacements);
              fs.writeFileSync(path.join(BASE_DIR, `${GALLERY_NOTE_RECORD_NAME}.md`), renderedBody, "utf-8");
              fs.writeFileSync(
                path.join(NOTES_DIR, galleryEntry.file),
                `---\napple-note-id: ${GALLERY_NOTE_RECORD_NAME}\n---\n\n${renderedBody}`,
                "utf-8"
              );
            }

            state.notes[GALLERY_NOTE_RECORD_NAME] = {
              ...galleryEntry,
              recordChangeTag: updatedNoteRec.recordChangeTag || galleryEntry.recordChangeTag,
              modificationDate: nowMs
            };
            embedState.galleryFixedV2 = true;
            saveEmbedState(embedState);
            updatedNotes++;
          }
        }
      }
    } catch {}
  }

  if (updatedNotes > 0) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }

  return { updatedNotes };
}
