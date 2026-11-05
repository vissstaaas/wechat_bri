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
   - **iCloud Drive 云盘文件互通**：支持从微信调取云盘简历、课件直接发送回微信，支持微信原图直传 iCloud 云盘《学习照片》。
   - **备忘录原生富文本图片嵌入**：作为原生 `Attachment`（`public.jpeg` / `public.png`）嵌入备忘录。

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

### 1. 安装依赖

```bash
cd wechat-notes-bridge
npm install
```

### 2. 启动服务

```bash
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
