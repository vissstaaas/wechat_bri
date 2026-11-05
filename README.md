# NoteBridge AI (微信 ⇄ Apple 备忘录 / iCloud 全能智能管家)

> 灵感源自 `typesafe.ai`（`TS.AI.OS1` 设计哲学），打通 **微信 (WeChat ClawBot)** 与 **Apple iCloud (`icloud.com.cn` 云上贵州 / 备忘录 / iCloud Drive 云盘)** 的全自动化双模 AI Agent 桥梁。

---

## 🌟 核心特性

1. **双模 AI Agent 与智能分流**
   - **全能问答 Agent**：基于 Local LLM / DeepSeek-V4.1-Flash，支持智能问答、备忘录知识库问答。
   - **智能速记模式**：自动进行多分类打标（账号与重要速查、待办与取件码、链接稍后读、灵感随手记等）。
   - **Siri 语音反查无缝联动**：保存后即可直接呼叫 Siri 读取备忘录。

2. **Apple iCloud / 备忘录 / 云盘全打通**
   - **原生 CloudKit TopoText CRDT 同步**：免手机端额外 App，双向同步秒级送达。
   - **原生内嵌大图渲染 (Full Inline Preview)**：
     - 内置零外部依赖的纯二进制 Buffer 解析引擎，毫秒级提取 PNG/JPEG 物理像素宽高（`width` / `height`）。
     - 深度重构 CloudKit 级联模型，规范 `Media.parent -> Attachment -> Note` 关联指针。
     - 注入 `PreferredViewSize=1`、`PreviewUpdateDate`、`SizeWidth` 与 `SizeHeight` 排版元数据，实现与 iPhone 本机手动插入图片完全一致的正文大图直接渲染展示，告别通用文件卡片占位。
   - **iCloud Drive 云盘文件互通**：支持从微信调取云盘简历、课件直接发送回微信，支持微信原图直传 iCloud 云盘《学习照片》。

3. **`TS.AI.OS1` 现代工业感三段式架构**
   - **Stage 1: Hero 产品与技术架构全景展示**
   - **Stage 2: Quickstart 双码配对引导**（微信 ClawBot 扫码登录 + Apple ID 快捷认证）
   - **Stage 3: TS.AI 专属控制台与工作台 (Playground)**
     - 规则微调与动态分类本扩展
     - 备忘录全库检索与秒级预览
     - iCloud 云盘与原生图库联动管理
     - 微信 Dual-Mode 实时调试终端与实时日志流

---

## 🚀 快速启动

### 方式一：Windows 一键启动（推荐）

双击根目录下的 **`start-bridge.bat`** 即可。
脚本具备自检能力，会自动检测并安装所需依赖并启动服务。

### 方式二：命令行启动

```bash
npm install
npm start
# 或者运行 node server.js
```

浏览器访问：`http://localhost:3080`

---

## 🛠️ 技术栈

- **后端**：Node.js (ESM), HTTP, WebSocket/SSE
- **前端**：Vanilla HTML5 + Modern CSS (Custom Grid & Typography Inspired by `typesafe.ai`)
- **协议支撑**：`weixin-agent-sdk`, `icloud-md` (Apple CloudKit Protocol & Protobuf TopoText CRDT)
- **AI 引擎**：Local OpenAI-Compatible API / DeepSeek-V4.1


---

## 📝 近期架构升级记录 (Changelog)

### 1. 网页端微信 iLink 扫码登录引擎完整闭环 (`server.js`)
- **协议头对齐**：修正 `/api/wechat/qr` 请求头，采用官方 `iLink-App-Id: bot`、位运算协议版本 `1536` (`0.6.0`)、`AuthorizationType: ilink_bot_token` 及随机 `X-WECHAT-UIN` 签名，消除手机端扫码报“网络错误”问题。
- **异步长轮询与跨机房重定向**：在 `createWechatQrSession()` 中内置 `pollWechatQrStatusLoop()` 后台协程，支持 `/ilink/bot/get_qrcode_status` 35s 长轮询及 `scaned_but_redirect` 跨机房动态路由切换。
- **凭证自动持久化与热挂载**：扫码确认（`confirmed`）后自动写入 `~/.openclaw/openclaw-weixin/accounts/` 并热启动 `startWechatBot()`，无需重启进程。

### 2. Quickstart 向导门控与 iCloud 登录（`server.js` / `public/index.html` / `scripts/patch-icloud-cn.js`）
- **大陆站补丁**：`npm install` 的 `postinstall` 会执行 `scripts/patch-icloud-cn.js`，把 `icloud-md` 的 setup 域名、登录页与 cookie 过滤切到 `icloud.com.cn`（可重复执行，也可手动 `npm run patch:icloud-cn`）。
- **iCloud 登录流程**：页面点击「登录 iCloud」→ 服务端弹出独立 Chromium 窗口完成 Apple ID 登录 → 取回凭证并校验 → 首次同步备忘录目录 `notes/`。不再使用黑框。
  - `POST /api/icloud/relogin`：开始登录
  - `GET /api/icloud/login/status`：进度，`stage` 取值 `idle | browser_open | verifying | cloning | done | failed`，失败时带 `error`
- **向导门控**：微信登录成功才解锁 Step 2；iCloud 成功才解锁 Step 3；每步状态、失败原因与重试入口都在页面内显示，成功后自动进入下一步。
- **启动脚本**：`start-bridge.bat` 检测到未登录微信时才进入终端扫码；`login-apple.bat` 已不再需要。

### 3. 微信图片 1:1 iPhone 原生大图内嵌与多备忘录同步引擎 (`wechat-image-embedder.js` / `server.js` / `embedPushEdit.js`)
- **二进制魔数识别与规范命名**：针对 `weixin-agent-sdk` 落地临时文件后缀为 `.bin` 的问题，新增 `inspectImageBuffer()` 与 `normalizeImageFileName()`，自动解析 JPEG (`0xFF 0xD8`) / PNG (`0x89 0x50`) 魔数与真实像素宽高 (`Width` / `Height`)，规范重命名为 Apple Notes 原生相机格式 `IMG_<timestamp>.jpeg`。
- **1:1 复刻 iOS 原生内嵌大图协议**：
  - 移除 `Attachment` 记录上的 `FilenameEncrypted` 与 `TitleEncrypted`（仅在 `Media` 记录中保留 `FilenameEncrypted`），避免 iOS 备忘录将其降级渲染为文件附件卡片；
  - 注入完整 `Width`、`Height`、`CroppingQuad*` 裁剪框坐标及 `UTI: "public.jpeg"`，将 `Media.parent` 指向所属 `Note`，并将 `\uFFFC` 及其后换行符设为独立 `style: 3` 正文段落，通过 `applyFormattingOp` 更新 CRDT 样式时钟。
- **全量备忘录自愈与直嵌**：不仅嵌入《🖼️ 微信图片速记测试》，同时自动将《微信收集箱》与各分类备忘录（如《💡 灵感与随手记》）中的 `[图片]` 原地升级为 CloudKit 原生内嵌大图。
- **解除含图备忘录只读限制**：扩展 `node_modules/icloud-md/dist/notes/embedPushEdit.js` 的 `planEmbedRepresentations()`，支持将本地 Markdown 中的 `![...](attachments/...)` 还原为 `OBJECT_REPLACEMENT_CHARACTER` (`\uFFFC`)，实现同一篇备忘录内原生大图与后续新增文字的无限次双向增量同步。
- **AI 问答意图识别增强**：在 `classifyMessageIntent()` 中扩充 `给我|生成|写个|写段|实现|代码|算法|聊聊|讲讲` 等触发词，确保编程与问答指令精准路由至 AI Agent。

### 4. 双模式引擎（📥 模式一：信息存档管家 vs 🤖 模式二：全能 AI 助手）全面恢复与升级 (`server.js` / `public/index.html`)
- **三态模式自由切换**：
  - `DUAL_AUTO`（⚡ 智能双模自动分流，默认）：提问、写代码、查备忘录、提取 iCloud 云盘文件自动路由至 **🤖 AI 助手**；随手发账号密码、待办取件码、链接、图片自动归档至 **📥 iPhone 备忘录**。
  - `NOTES_FIRST`（📥 模式一：纯信息存档模式）：所有消息 100% 自动分类归档进 iPhone 备忘录。
  - `AGENT_FIRST`（🤖 模式二：纯 AI 助手模式）：所有消息由 AI 助手回答，不自动写入备忘录。
- **微信端自然语言口令秒切**：在手机微信直接发送 `AI模式` / `助手模式`、`存档模式` / `备忘录模式`、`双模` / `智能模式` 或 `模式` 即可随时切换并查看状态，无需打开网页。
- **多级高可用 AI Agent 引擎 (`runConversationalAgent`)**：
  1. **确定性工具直连**：内置本地备忘录检索 (`searchNotes`) 与云上贵州 iCloud 云盘检索/文件提取 (`listIcloudDriveItems` / `downloadIcloudDriveFile`)，确保说“把云盘里的简历发给我”或“查一下备忘录里的宽带密码” 100% 毫秒级命中。
  2. **三级大模型与智能兜底**：优先连接本地 `127.0.0.1:3425` (DeepSeek-V4.1)，若未开启则自动无缝切换至免 Key 云端 OpenAI 兼容网关及内置算法/知识生成引擎（`buildSmartLocalAgentReply`），彻底杜绝问答失效。
- **网页端全局双模式切换栏**：在顶部导航栏与 Playground 首屏均提供显眼的双模式切换开关，与手机微信实时双向同步。

### 5. iCloud 相册/图库多维语义索引与批量关键词/OCR 搜图引擎 (`photo-index-engine.js` / `server.js` / `public/index.html`)
- **混合架构设计（解决 iCloud 端侧加密索引不可直调问题）**：
  - 结合 CloudKit 原生相册/附件元数据与本地轻量级多模态视觉 & OCR 索引库（`notes/.icloud-md/photo-index.json`），零外部重型依赖。
  - 当微信发送新图片或从网页上传图片时，自动调用 `analyzeAndIndexNewPhoto()` 提取图片类型（`category`）、画面视觉标签（`tags`）、图中 OCR 文字（`ocrText`）与一句话画面描述（`summary`）。
- **多维加权批量检索引擎 (`searchPhotosByQuery`)**：
  - 支持按 **画面物体/场景**（如：`剥香蕉`、`鸡腿盒饭`、`狮子头`）、**图中 OCR 文字**（如：`通行密钥`、`apple.com`、`使用密钥登录`）、**图片类型**（`美食`、`水果`、`屏幕截图`、`二维码`）及 **拍摄时间/最新** 进行多维加权检索与双字词根模糊召回。
  - 新增 `POST /api/photos/search` 接口，并在 `GET /api/icloud/drive` 的 `noteImages` 中同步返回完整视觉标签与 OCR 索引。
- **微信自然语言找图直发原图 & 控制台视觉搜索 UI**：
  - 在微信对机器人说 **“把我相册里剥香蕉的那张照片发给我”**、**“把图上有通行密钥二维码的那张截图发给我”** 或 **“把鸡腿盒饭那张美食图发给我”**，AI 助手自动匹配最优图片，将高清原图直接发回微信，并在回执中附上命中依据（画面描述 / OCR 识别文字）及同批次其余匹配候选列表。
  - 网页控制台 `03. iCloud 云盘与图库互通` 新增实时视觉/OCR 搜图栏与快捷筛选标签，每张图片卡片直观展示 `[分类]`、`🏷️ 视觉标签` 与 `🔤 OCR 文字`。
