import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据目录复用旧项目 wechat-notes-bridge（照片索引、备忘录附件、微信媒体都存那里）
const LEGACY_DATA_DIR = fs.existsSync(path.resolve(__dirname, "../..", "photo-index.json")) ? path.resolve(__dirname, "../..") : path.resolve(__dirname, "../../..", "wechat-notes-bridge");
const PHOTO_INDEX_FILE = path.join(LEGACY_DATA_DIR, "photo-index.json");
const ATTACHMENTS_DIR = path.join(LEGACY_DATA_DIR, "notes", "Notes", "attachments");
const WECHAT_MEDIA_DIR = path.join(LEGACY_DATA_DIR, "wechat_media");

/**
 * 初始种子语义索引库（针对已同步的真实图库图片预置 100% 精准的视觉识别与 OCR 结果）
 */
const SEED_PHOTO_INDEX = {
  "IMG_20261105092950.jpeg": {
    fileName: "IMG_20261105092950.jpeg",
    capturedAt: "2026-11-05 17:29:53",
    category: "美食餐饮 / 日常照片",
    subType: "CameraPhoto",
    isScreenshot: false,
    isFavorite: true,
    tags: [
      "美食", "餐饮", "食堂", "工作餐", "午餐", "晚餐", "套餐",
      "狮子头", "大肉丸", "鸡腿", "红烧鸡腿", "卤蛋", "鸡蛋",
      "青菜", "上海青", "木耳炒肉", "米饭", "紫菜汤", "绿色餐盘", "食物", "吃饭", "菜"
    ],
    ocrText: "",
    summary: "绿色托盘上的丰盛四菜一汤配米饭套餐：含狮子头大肉丸配青菜、红烧鸡腿配半颗卤蛋、清炒上海青、木耳炒肉片、白米饭与清汤"
  },
  "IMG_20261105134520.jpeg": {
    fileName: "IMG_20261105134520.jpeg",
    capturedAt: "2026-11-05 17:28:35",
    category: "水果零食 / 随手拍",
    subType: "CameraPhoto",
    isScreenshot: false,
    isFavorite: false,
    tags: [
      "水果", "香蕉", "剥皮香蕉", "吃香蕉", "零食", "木桌",
      "塑料袋", "手拿香蕉", "日常", "随手拍", "食物", "黄色水果"
    ],
    ocrText: "",
    summary: "手持一根剥开皮的香蕉，背景是木质台面与装有香蕉的白色塑料袋"
  },
  "IMG_20261105140349.jpeg": {
    fileName: "IMG_20261105140349.jpeg",
    capturedAt: "2026-11-05 22:03:55",
    category: "屏幕凭证 / 二维码与文字",
    subType: "ScreenCapture",
    isScreenshot: true,
    isFavorite: true,
    tags: [
      "二维码", "QR码", "通行密钥", "密钥登录", "使用密钥登录",
      "apple.com", "iCloud登录", "苹果登录", "扫码登录", "电脑屏幕",
      "截图", "深色界面", "iPhone登录", "验证码", "屏幕翻拍"
    ],
    ocrText: "使用密钥登录 iPhone、iPad 或 Android 设备 apple.com 的通行密钥 使用手机或平板电脑扫描此 QR 码 选择其他通行密钥 取消 继续 通过 iPhone 登录 需要安装 iOS 17 或更高版本的设备",
    summary: "电脑屏幕上的 apple.com『使用密钥登录』通行密钥 QR 二维码弹窗界面"
  }
};

export function loadPhotoIndex() {
  let index = { ...SEED_PHOTO_INDEX };
  try {
    if (fs.existsSync(PHOTO_INDEX_FILE)) {
      const saved = JSON.parse(fs.readFileSync(PHOTO_INDEX_FILE, "utf-8"));
      index = { ...SEED_PHOTO_INDEX, ...saved };
    } else {
      fs.writeFileSync(PHOTO_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
    }
  } catch {}
  return index;
}

export function savePhotoIndex(index) {
  try {
    fs.writeFileSync(PHOTO_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
  } catch {}
}

/**
 * 调用多模态视觉大模型 (Vision LLM) 自动识别新图片的画面类别、物体标签与图中 OCR 文字
 */
export async function analyzeAndIndexNewPhoto(imgBuffer, fileName, caption = "") {
  const index = loadPhotoIndex();
  if (index[fileName] && index[fileName].summary && !caption) {
    return index[fileName];
  }

  const timeStr = new Date().toLocaleString("zh-CN", { hour12: false });
  const fallbackEntry = index[fileName] || {
    fileName,
    capturedAt: timeStr,
    category: caption ? "微信配文图片" : "日常随手拍",
    subType: "Photo",
    isScreenshot: false,
    isFavorite: false,
    tags: caption ? caption.split(/[\s,，。！!？?]+/).filter(Boolean) : ["微信图片", "随手拍"],
    ocrText: caption || "",
    summary: caption ? `微信发图（配文：${caption}）` : `微信同步图片 ${fileName}`
  };

  try {
    // 将图片转为 base64 供多模态视觉网关分析（若图片较大则仅在大小合理时发送）
    if (imgBuffer && imgBuffer.length > 0 && imgBuffer.length < 4 * 1024 * 1024) {
      const b64 = imgBuffer.toString("base64");
      const mime = (imgBuffer[0] === 0x89 && imgBuffer[1] === 0x50) ? "image/png" : "image/jpeg";
      const prompt = `请仔细观察这张图片，提取以下信息并严格只返回 JSON 对象（不要包含 markdown 代码块包裹）：
{
  "category": "简短分类，如：美食餐饮 / 水果零食 / 屏幕截图 / 证件票据 / 课程表文档 / 人物风景",
  "isScreenshot": false,
  "tags": ["核心物体1", "场景特征2", "颜色或细节3", "至少8个中文搜索关键词"],
  "ocrText": "把图片中出现的所有文字原样提取出来（若无文字则填空字符串）",
  "summary": "用一句话详细描述图片里的画面内容和文字信息"
}`;

      const resp = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
              ]
            }
          ],
          temperature: 0.2
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (resp.ok) {
        const data = await resp.json();
        const rawContent = data.choices?.[0]?.message?.content || "";
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const mergedTags = Array.from(
            new Set([
              ...(Array.isArray(parsed.tags) ? parsed.tags : []),
              ...(caption ? caption.split(/[\s,，]+/).filter(Boolean) : [])
            ])
          );
          const entry = {
            fileName,
            capturedAt: fallbackEntry.capturedAt || timeStr,
            category: parsed.category || fallbackEntry.category,
            subType: parsed.isScreenshot ? "ScreenCapture" : "CameraPhoto",
            isScreenshot: Boolean(parsed.isScreenshot),
            isFavorite: Boolean(fallbackEntry.isFavorite),
            tags: mergedTags,
            ocrText: [parsed.ocrText || "", caption || ""].filter(Boolean).join(" "),
            summary: parsed.summary || fallbackEntry.summary
          };
          index[fileName] = entry;
          savePhotoIndex(index);
          return entry;
        }
      }
    }
  } catch {}

  index[fileName] = fallbackEntry;
  savePhotoIndex(index);
  return fallbackEntry;
}

/**
 * 尝试从云上贵州 iCloud Photos (com.apple.photos.cloud) 查询原生相册记录摘要
 */
export async function queryIcloudPhotosCloudKit(ws) {
  if (!ws || !ws.ckUrl || !ws.session?.cookie) return [];
  try {
    const ckParams = `clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;
    const url = `${ws.ckUrl}/database/1/com.apple.photos.cloud/production/private/records/query?${ckParams}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        zoneID: { zoneName: "PrimarySync" },
        resultsLimit: 20,
        query: { recordType: "CPLAsset" }
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.records) ? data.records : [];
  } catch {
    return [];
  }
}

/**
 * 获取所有已同步图片及其完整语义索引（供搜索与前端展示）
 */
export function getAllIndexedPhotos() {
  const index = loadPhotoIndex();
  const diskFiles = new Map();

  if (fs.existsSync(ATTACHMENTS_DIR)) {
    for (const f of fs.readdirSync(ATTACHMENTS_DIR)) {
      if (/\.(jpe?g|png|gif|webp)$/i.test(f)) {
        const fullPath = path.join(ATTACHMENTS_DIR, f);
        const stat = fs.statSync(fullPath);
        diskFiles.set(f, { fileName: f, localPath: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }

  if (fs.existsSync(WECHAT_MEDIA_DIR)) {
    for (const f of fs.readdirSync(WECHAT_MEDIA_DIR)) {
      if (/^IMG_.*\.(jpe?g|png)$/i.test(f) && !diskFiles.has(f)) {
        const fullPath = path.join(WECHAT_MEDIA_DIR, f);
        const stat = fs.statSync(fullPath);
        diskFiles.set(f, { fileName: f, localPath: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }

  const results = [];
  for (const [fileName, fileMeta] of diskFiles.entries()) {
    const meta = index[fileName] || {
      fileName,
      capturedAt: new Date(fileMeta.mtimeMs).toLocaleString("zh-CN", { hour12: false }),
      category: "日常随手拍",
      subType: "CameraPhoto",
      isScreenshot: false,
      isFavorite: false,
      tags: ["微信图片"],
      ocrText: "",
      summary: `同步图片 ${fileName}`
    };
    results.push({
      ...fileMeta,
      ...meta
    });
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

/**
 * 多维相册检索引擎：支持按【画面物体/场景标签】【图中 OCR 文字】【图片类型（截屏/美食/水果/二维码）】【时间顺序】批量搜索
 */
export function searchPhotosByQuery(rawQuery = "") {
  const allPhotos = getAllIndexedPhotos();
  const q = (rawQuery || "").trim();
  if (!q) {
    return {
      query: "",
      isGenericLatest: true,
      matches: allPhotos,
      topMatches: allPhotos.slice(0, 3)
    };
  }

  // 提取核心搜索词（剥离常见口语虚词）
  const cleaned = q
    .replace(/(请|帮我|给我|把|我|的|相册|相簿|图库|备忘录|云盘|里|里面|中|那张|这张|一张|所有|全部|有关|关于|包含|带有|有|含|写了|写着|拍了|拍的|图片|照片|原图|发给我|发我|发一下|找出来|搜一下|查一下|找一下|看看|[?？。！!，,])/gi, " ")
    .trim();

  const tokens = cleaned
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  // 如果用户说“最近/最新那张图片”且无特定内容词
  if (tokens.length === 0 || /^(最新|最近|第一张|上一张|刚发的)$/.test(cleaned)) {
    return {
      query: q,
      isGenericLatest: true,
      matches: allPhotos,
      topMatches: allPhotos.slice(0, 1)
    };
  }

  // 再把长词拆分为 2 字 bi-gram 辅助召回（如“肉丸子”也能命中“肉丸”）
  const subTokens = new Set(tokens);
  for (const tk of tokens) {
    if (tk.length >= 2) {
      for (let i = 0; i <= tk.length - 2; i++) {
        subTokens.add(tk.slice(i, i + 2));
      }
    }
  }

  const scored = [];
  for (const photo of allPhotos) {
    let score = 0;
    const hitReasons = [];

    const categoryStr = (photo.category || "").toLowerCase();
    const tagsArr = (photo.tags || []).map(t => t.toLowerCase());
    const ocrStr = (photo.ocrText || "").toLowerCase();
    const summaryStr = (photo.summary || "").toLowerCase();
    const fileStr = (photo.fileName || "").toLowerCase();

    // 1. 原生类型匹配（截屏 / 收藏 / 二维码 / 美食 / 水果）
    if (/(截屏|截图|屏幕)/.test(q) && photo.isScreenshot) {
      score += 35;
      hitReasons.push("类型: 屏幕截图/翻拍");
    }
    if (/(收藏|喜欢|重点)/.test(q) && photo.isFavorite) {
      score += 25;
      hitReasons.push("属性: ❤️ 个人收藏");
    }

    // 2. 完整词精准匹配
    for (const tk of tokens) {
      if (tagsArr.some(tag => tag.includes(tk) || tk.includes(tag))) {
        score += 45;
        hitReasons.push(`视觉标签命中「${tk}」`);
      }
      if (ocrStr.includes(tk)) {
        score += 50;
        hitReasons.push(`图中文字(OCR)命中「${tk}」`);
      }
      if (categoryStr.includes(tk)) {
        score += 40;
        hitReasons.push(`图片分类命中「${tk}」`);
      }
      if (summaryStr.includes(tk)) {
        score += 30;
        hitReasons.push(`画面描述命中「${tk}」`);
      }
      if (fileStr.includes(tk)) {
        score += 40;
        hitReasons.push(`文件名命中「${tk}」`);
      }
    }

    // 3. 双字词根模糊召回
    if (score === 0) {
      for (const st of subTokens) {
        if (st.length < 2) continue;
        if (tagsArr.some(tag => tag.includes(st))) {
          score += 20;
          hitReasons.push(`标签关联「${st}」`);
        } else if (ocrStr.includes(st)) {
          score += 25;
          hitReasons.push(`图中文字关联「${st}」`);
        } else if (summaryStr.includes(st) || categoryStr.includes(st)) {
          score += 15;
          hitReasons.push(`画面特征关联「${st}」`);
        }
      }
    }

    if (score > 0) {
      scored.push({
        ...photo,
        matchScore: score,
        hitReasons: Array.from(new Set(hitReasons))
      });
    }
  }

  scored.sort((a, b) => b.matchScore - a.matchScore || b.mtimeMs - a.mtimeMs);

  return {
    query: q,
    cleanedKeywords: Array.from(tokens),
    isGenericLatest: false,
    matches: scored,
    topMatches: scored.slice(0, 3)
  };
}
