# OmniBridge Core (全能智能数据集散总线)

> 🚀 **OmniBridge (OB.OS1)** 是一个面向多用户的商业级跨生态智能数据集散总线与 AI 协作中枢。
> 左侧连接即时通讯（微信官方开源 SDK、Telegram、飞书、钉钉），右侧直通生产力生态（Apple iCloud 备忘录/云盘/相册、Notion、NAS），中间搭载双模自适应 AI 分流与零知识（Zero-Knowledge）内存流传输引擎。

---

## 🌟 核心特性与架构优势

1. **总线式适配器架构（Bus & Adapters）**
   - **左侧输入端 (Channels)**：基于**微信官方开源 SDK (`weixin-agent-sdk`)** 原生接入，合规稳定，支持 iLink 扫码即登录；预留 TG、钉钉、飞书标准接入接口。
   - **右侧输出端 (Sinks)**：自主封装 Apple iCloud 全生态能力（原生富文本与大图嵌入 Notes、云盘 Drive 分块直传、相册 Photos 视觉检索）。
   - **微内核总线 (Core)**：统一标准化消息信封（`MessageEnvelope`），实现跨生态无缝穿透。

2. **多租户强隔离（Multi-Tenant Boundary）**
   - 彻底摒弃单例全局变量共享。
   - 每个用户接入分配独立的 `tenantId`，享有专属的 `TenantContext` 沙箱，一人一域，凭证、配置与状态互不干扰。

3. **零磁盘驻留与阅后即焚（Zero-Disk RAM-only Pipeline）**
   - 用户发送的私密照片、视频与文件全链路采用 V8 内存流（`StreamSanitizer`）处理。
   - 在内存中嗅探 Magic Bytes 格式并直推云端，**绝不在服务器磁盘留存任何物理文件**，流传输完毕主动内存填零（Wipe），保障商业级最高隐私标准。

4. **真实被动探活心跳（Real-Time Active Probe）**
   - 实时捕获腾讯微信服务器 `-14 (session timeout)`。
   - 实时捕获苹果云上贵州 `HTTP 421 / 401`。
   - 状态机精准联动，彻底解决断线后界面假死与卡在 Step 3 的问题。

---

## 📚 完整工程文档库

| 文档名称 | 路径 | 核心内容 |
| :--- | :--- | :--- |
| **产品需求规格说明书 (PRD)** | [`docs/PRD_REQUIREMENTS.md`](docs/PRD_REQUIREMENTS.md) | 战略定位、目标用户画像、业务场景、核心功能需求与非功能规范 |
| **系统架构与设计说明书 (SAD)** | [`docs/ARCHITECTURE_DESIGN.md`](docs/ARCHITECTURE_DESIGN.md) | 总体拓扑、数据流转时序、接口规范（REST/SSE）、核心模块职责 |
| **零信任安全与合规白皮书** | [`docs/SECURITY_COMPLIANCE.md`](docs/SECURITY_COMPLIANCE.md) | 零磁盘落盘、多租户防越权（CWE-639）、凭证加密与自主知识产权合规 |

---

## 🚀 快速启动

### 1. 安装依赖
```bash
cd omnibridge-core
npm install
```

### 2. 启动服务
```bash
npm start
```
服务默认监听：`http://localhost:3090`
