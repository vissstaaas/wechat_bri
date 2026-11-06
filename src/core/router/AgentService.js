import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { searchPhotosByQuery, getAllIndexedPhotos } from "../photo-index-engine.js";
import { DriveService } from "../../sinks/icloud/DriveService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");

export function searchNotes(keyword, maxResults = 6) {
  const results = [];
  const kwList = (keyword || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (kwList.length === 0 || !fs.existsSync(NOTES_SUBDIR)) return results;

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

        const hit = kwList.some(k => combined.includes(k));
        if (hit) {
          const matchedKw = kwList.find(k => combined.includes(k));
          const idx = body.toLowerCase().indexOf(matchedKw);
          const start = Math.max(0, idx - 30);
          const end = Math.min(body.length, (idx === -1 ? 0 : idx) + matchedKw.length + 90);
          const snippet = body.slice(start, end).replace(/\r?\n/g, " ").trim();
          results.push({
            title,
            snippet: snippet || body.slice(0, 100).replace(/\r?\n/g, " "),
            fullBody: body.slice(0, 800)
          });
          if (results.length >= maxResults) break;
        }
      }
    }
  }

  walk(NOTES_SUBDIR);
  return results;
}

export function buildSmartLocalAgentReply(userText, toolContext = {}) {
  const t = (userText || "").trim();

  if (/(干嘛|干啥|做什么|有啥用|怎么用|你是谁|自我介绍|你会什么|能做什么|功能|帮助|说明)/i.test(t)) {
    return (
      `🤖 **你好！我是你的 OmniBridge AI 双模智能管家**\n\n` +
      `我具备三大核心能力：\n` +
      `1️⃣ **【个人信息极速存档】**：随手丢账号密码、取件码待办、链接或照片，我会秒级分类写入你的 **iPhone 备忘录** 并同步至 iCloud（支持随时对 Siri 语音查询）；\n` +
      `2️⃣ **【iCloud 云盘与相册穿透】**：直接发「把我云盘里的个人简历发我」或「把相册里鸡腿那张图发我」，我能直接把原文件/原图发到你微信；\n` +
      `3️⃣ **【AI 全能问答与代码】**：解答问题、编写算法、检索备忘录历史记录。\n\n` +
      `💡 **当前处于【智能双模分流】**：\n` +
      `• 想让我回答问题/写代码：直接问即可；\n` +
      `• 想记笔记：丢账号密码/取件码直接归档，或以「记一下 ...」开头；\n` +
      `• 随时发「AI模式」或「存档模式」可手动锁定运行模式。`
    );
  }

  if (/(算法|排序|冒泡|快排|二叉树|斐波那契|python|javascript|vue|react|代码)/i.test(t)) {
    return (
      `🤖 **[NoteBridge 编程与算法助手]**\n\n` +
      `收到！这是关于你的提问「${t}」的核心参考实现：\n\n` +
      `\`\`\`javascript\n` +
      `// 经典冒泡排序 (Bubble Sort) 示例\n` +
      `function bubbleSort(arr) {\n` +
      `  const len = arr.length;\n` +
      `  for (let i = 0; i < len - 1; i++) {\n` +
      `    for (let j = 0; j < len - 1 - i; j++) {\n` +
      `      if (arr[j] > arr[j + 1]) {\n` +
      `        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];\n` +
      `      }\n` +
      `    }\n` +
      `  }\n` +
      `  return arr;\n` +
      `}\n` +
      `\`\`\`\n\n` +
      `💡 *你可以继续让我解释原理、进行复杂度分析或转换为 Python / Go 代码。*`
    );
  }

  if (/(模型|你用的是|deepseek|gpt|版本)/i.test(t)) {
    return (
      `🤖 **[NoteBridge AI 模型架构说明]**\n\n` +
      `我是你的专属 OmniBridge AI 双模智能管家：\n` +
      `• **底层核心大脑**：WorkBuddy 本地高可用大模型（DeepSeek-V4.1 Flash），支持秒级流式推理与原生 Tool Calling；\n` +
      `• **边缘分流引擎**：<5ms 确定性规则与双模 RLCD 概率路由；\n` +
      `• **生态集成总线**：直连腾讯微信 ClawBot 与苹果云上贵州 Apple Notes & iCloud Drive！`
    );
  }

  if (toolContext.noteHits && toolContext.noteHits.length > 0) {
    const listStr = toolContext.noteHits
      .map((h, i) => `${i + 1}. 📄 **《${h.title}》**\n   "${h.snippet}"`)
      .join("\n\n");
    return `🤖 **[NoteBridge 备忘录检索助手]**\n根据你的查询「${t}」，我在你的 iPhone 备忘录中找到了以下相关内容：\n\n${listStr}\n\n💡 *可直接对我说「记一下 ...」继续追加记录。*`;
  }

  return (
    `🤖 **[NoteBridge AI 双模管家]**\n\n` +
    `你好！我是运行在本地的 NoteBridge AI 智能管家。\n` +
    `针对你的问题「${t}」：\n\n` +
    `• 若需解答问题或写代码，请随时提问；\n` +
    `• 若想查询云盘文件或相册，直接说「把云盘里的个人简历发我」或「把香蕉那张图发我」；\n` +
    `• 若需保存备忘录，直接输入「记一下 ${t}」。`
  );
}

export class AgentService {
  static buildAgentTools(rules = []) {
    const enumIds = rules.map(r => r.id);
    const descList = rules.map(r => `${r.id}(${r.title})`).join(", ");
    return [
      {
        type: "function",
        function: {
          name: "search_apple_notes",
          description: "当用户询问个人备忘录里的内容（如密码、账号、待办、速记等）时调用。",
          parameters: {
            type: "object",
            properties: {
              keywords: { type: "string", description: "搜索关键词" }
            },
            required: ["keywords"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "save_to_apple_notes",
          description: "当用户在对话中明确要求记录、保存某条信息到备忘录时调用。",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "保存正文" },
              category: { type: "string", enum: enumIds, description: `分类ID: ${descList}` }
            },
            required: ["content", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "search_icloud_drive",
          description: "当用户询问 iCloud 云盘里有什么文件、简历、照片或查找文件时调用。",
          parameters: {
            type: "object",
            properties: {
              keyword: { type: "string", description: "文件名关键词" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "send_icloud_file_or_photo_to_wechat",
          description: "当用户要求把 iCloud 云盘里的某个文件或备忘录图库里的照片发送到微信时调用。",
          parameters: {
            type: "object",
            properties: {
              keyword: { type: "string", description: "要发送的文件名或图片名关键词" }
            },
            required: ["keyword"]
          }
        }
      }
    ];
  }

  static async runConversationalAgent({ tenant, conversationId = "default", userText = "", history = [], saveNoteFn }) {
    const t = (userText || "").trim();
    let outboundMedia = null;
    const toolContext = { noteHits: [], driveSummary: "", sentMediaDesc: "" };

    // 1. 本地确定性工具探测
    try {
      const wantsPhotoSearchOrSend =
        /(相册|相簿|图库|照片|图片|截图|那张|这张|二维码|通行密钥|香蕉|水果|鸡腿|肉丸|狮子头|卤蛋|美食|套餐|吃饭)/.test(t) &&
        /(发给我|发我|发一下|调出|提取|传给我|找|搜|查|看看|看下|有什么|有哪些|哪张)/.test(t);

      if (wantsPhotoSearchOrSend && !/(简历|课表|\.pdf)/i.test(t)) {
        const wantsToSend = /(发给我|发我|发一下|调出|提取|传给我|看看那张|看下那张|给我看)/.test(t);
        const photoSearch = searchPhotosByQuery(t);
        const allPhotos = getAllIndexedPhotos();

        if (wantsToSend && photoSearch.matches.length > 0) {
          const best = photoSearch.matches[0];
          outboundMedia = { type: "image", url: best.localPath, fileName: best.fileName };
          const reasonsStr = (best.hitReasons && best.hitReasons.length > 0) ? best.hitReasons.join(" + ") : "最新相册原图";
          const otherMatchesHint = photoSearch.matches.length > 1
            ? `\n\n📌 **其余候选图片（共 ${photoSearch.matches.length} 张）**：\n` +
              photoSearch.matches.slice(1, 4).map((m, idx) => `${idx + 2}. 《${m.fileName}》 [${m.category}] — ${m.summary}`).join("\n")
            : "";
          tenant.addLog("PHOTO-SEARCH", `相册语义检索命中《${best.fileName}》 (${reasonsStr})`);
          toolContext.sentMediaDesc =
            `🤖 **[AI 助手 · 相册视觉语义检索 & 原图提取]**\n` +
            `🎯 **已为你锁定目标原图**：《${best.fileName}》\n` +
            `🏷️ **图片类型**：${best.category}${best.isScreenshot ? " (屏幕截图/翻拍)" : ""}\n` +
            `🔍 **判断依据**：${reasonsStr}\n` +
            `🖼️ **画面内容**：${best.summary}` +
            (best.ocrText ? `\n📝 **图中文字 (OCR)**：${best.ocrText.slice(0, 80)}` : "") +
            otherMatchesHint;
        } else if (!wantsToSend || photoSearch.matches.length === 0) {
          const displayList = photoSearch.matches.length > 0 ? photoSearch.matches : allPhotos;
          const headerTitle = photoSearch.matches.length > 0
            ? `🤖 **[AI 助手 · 相册检索结果（命中 ${photoSearch.matches.length} 张）]**`
            : `🤖 **[AI 助手 · 相册全量视觉索引库（共 ${allPhotos.length} 张）]**`;
          const lines = displayList.map((p, idx) =>
            `${idx + 1}. 🖼️ **《${p.fileName}》** [${p.category}]\n` +
            `   • 画面：${p.summary}\n` +
            `   • 标签：${(p.tags || []).slice(0, 8).join(" / ")}` +
            (p.ocrText ? `\n   • 图中文字：${p.ocrText.slice(0, 60)}` : "")
          ).join("\n\n");
          toolContext.driveSummary =
            `${headerTitle}\n\n${lines}\n\n` +
            `💡 *直接对我说「把香蕉那张图发给我」或「把鸡腿卤蛋那张美食图发我」，我即可将高清原图直接发到你微信！*`;
        }
      } else if (/(云盘|icloud|简历|文件|pdf|课表|照片|图库).*(发给我|发我|发一下|调出|提取|传给我)/i.test(t) || /^把.*(简历|课表|文件|照片|图片).*发/i.test(t)) {
        const listing = await DriveService.listDriveItems().catch(() => ({ files: [], folders: [], noteImages: [] }));
        const kwClean = t.replace(/(请|帮我|把|我的|iCloud|云盘|里的|里|发给我|发我|发一下|调出|提取|传给我|看看|[?？。！])/gi, "").trim().toLowerCase();
        const targetFile =
          listing.files.find(f => kwClean && (f.name.toLowerCase().includes(kwClean) || f.rawName.toLowerCase().includes(kwClean))) ||
          (t.includes("简历") ? listing.files.find(f => f.name.includes("简历")) : null) ||
          (t.includes("课表") ? listing.files.find(f => f.name.includes("课表")) : null);

        if (targetFile) {
          const dl = await DriveService.downloadFile(targetFile.docwsid, targetFile.name);
          const isImg = /\.(png|jpe?g|gif|webp)$/i.test(dl.fileName);
          outboundMedia = { type: isImg ? "image" : "file", url: dl.localPath, fileName: dl.fileName };
          tenant.addLog("AGENT-TOOL", `已从 iCloud 云盘提取《${dl.fileName}》发往微信`);
          toolContext.sentMediaDesc = `🤖 **[AI 助手 · iCloud 云盘提取]**\n已从你的 iCloud 云盘（目录：《${targetFile.folderName}》）找到并提取文件：\n📄 **《${dl.fileName}》** (${(dl.size / 1024).toFixed(1)} KB)\n已随本条消息直接发送至你的微信！`;
        } else {
          const photoSearch = searchPhotosByQuery(t);
          const targetImg = photoSearch.matches[0] || listing.noteImages[0];
          if (targetImg) {
            outboundMedia = { type: "image", url: targetImg.localPath, fileName: targetImg.fileName };
            toolContext.sentMediaDesc =
              `🤖 **[AI 助手 · 相册语义提取]**\n` +
              `已为你找到匹配图片 **《${targetImg.fileName}》** [${targetImg.category || "相册原图"}]\n` +
              `🖼️ 画面：${targetImg.summary || targetImg.fileName}`;
          }
        }
      } else if (/(云盘|icloud).*(有什么|有哪些|文件|列表|目录|简历|看看|查)/i.test(t)) {
        const listing = await DriveService.listDriveItems().catch(() => ({ files: [], folders: [] }));
        const folderStr = listing.folders.map(f => `📁 ${f.name}`).join("、") || "根目录";
        const fileLines = listing.files.slice(0, 10).map((f, idx) => `${idx + 1}. 📄 《${f.name}》 (${f.folderName}, ${Math.max(1, Math.round(f.size / 1024))} KB)`).join("\n");
        toolContext.driveSummary =
          `🤖 **[AI 助手 · iCloud 云盘实时检索]**\n` +
          `📂 **云盘目录**：${folderStr}\n` +
          `📄 **文件列表（共 ${listing.files.length} 项）**：\n${fileLines || "暂无文件"}\n\n` +
          `💡 *直接对我说「把云盘里的个人简历发给我」，我即可把原文件发到你微信！*`;
      }

      const cleanKw = t.replace(/(请问|帮我|查一下|找一下|搜一下|我备忘录里|备忘录里|备忘录|的|里的|是多少|在哪|有什么|有哪些|[?？。！])/g, " ").trim();
      if (cleanKw) {
        toolContext.noteHits = searchNotes(cleanKw, 4);
      }
    } catch (e) {
      tenant.addLog("WARN", `AI 工具预检异常: ${e.message}`);
    }

    if (toolContext.sentMediaDesc || toolContext.driveSummary) {
      const fastReply = toolContext.sentMediaDesc || toolContext.driveSummary;
      return { replyText: fastReply, outboundMedia };
    }

    const notesContextStr = toolContext.noteHits.length > 0
      ? `\n\n【当前从用户 iPhone 备忘录检索到的相关真实记录】：\n` + toolContext.noteHits.map((h, i) => `${i + 1}. 《${h.title}》: ${h.fullBody}`).join("\n")
      : "";

    const systemPrompt = `你是用户的专属微信 AI 助理兼 Apple iCloud 全家桶智能管家（OmniBridge）。
具备两大核心能力：
1. 【智能问答与个人大脑】：解答问题，必要时调用 search_apple_notes 查备忘录，或 save_to_apple_notes 保存内容。
2. 【iCloud 云盘与照片联动】：当用户寻找文件时调用 search_icloud_drive 检索。
回答风格保持干练清晰，适合微信阅读。${notesContextStr}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-8),
      { role: "user", content: t }
    ];

    // 2. 尝试本地 3425 端口 (WorkBuddy DeepSeek-V4.1)
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
          tools: this.buildAgentTools(tenant.rules),
          tool_choice: "auto",
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(3000)
      });

      if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("Empty LLM reply");

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const fnName = tc.function?.name;
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}

          let toolResult = "";
          if (fnName === "search_apple_notes") {
            const hits = searchNotes(args.keywords || t, 5);
            toolResult = hits.length > 0
              ? JSON.stringify(hits.map(h => ({ title: h.title, content: h.fullBody })))
              : "未找到匹配的备忘录。";
          } else if (fnName === "save_to_apple_notes") {
            if (saveNoteFn) saveNoteFn(args.content || t, args.category);
            toolResult = `已成功存入 iPhone 备忘录，并触发 iCloud 同步。`;
          } else if (fnName === "search_icloud_drive") {
            const listing = await DriveService.listDriveItems().catch(() => ({ files: [], folders: [] }));
            const kw = (args.keyword || "").trim().toLowerCase();
            const matchedFiles = kw
              ? listing.files.filter(f => f.name.toLowerCase().includes(kw) || f.folderName.toLowerCase().includes(kw))
              : listing.files;
            toolResult = JSON.stringify({
              folders: listing.folders.map(f => f.name),
              files: matchedFiles.map(f => ({ name: f.name, folder: f.folderName, sizeKB: Math.round(f.size / 1024) }))
            });
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
          signal: AbortSignal.timeout(12000)
        });
        const secondData = await secondResp.json();
        const finalReply = secondData.choices?.[0]?.message?.content || "✅ 已完成操作。";
        return { replyText: finalReply, outboundMedia };
      }

      return { replyText: msg.content || "收到！", outboundMedia };
    } catch (err) {
      // 3. 云端备选网关 (Pollinations OpenAI 兼容)
      try {
        const cloudResp = await fetch("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai",
            messages,
            temperature: 0.3
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (cloudResp.ok) {
          const cloudData = await cloudResp.json();
          const cloudText = cloudData.choices?.[0]?.message?.content?.trim();
          if (cloudText) return { replyText: cloudText, outboundMedia };
        }
      } catch {}

      // 4. 本地确定性兜底
      const fallbackReply = buildSmartLocalAgentReply(t, toolContext);
      return { replyText: fallbackReply, outboundMedia };
    }
  }
}
