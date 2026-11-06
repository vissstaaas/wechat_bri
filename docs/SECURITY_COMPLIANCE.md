# OmniBridge Core 零信任安全防护与合规规划说明书 (Security & Compliance Whitepaper)

**文档版本**：v1.0.0  
**定稿时间**：2026-11-06  
**安全级别**：高隐私 / 商业合规标准  

---

## 1. 核心安全防护原则 (Zero-Trust Principles)

1. **零磁盘驻留（Zero-Disk Footprint）**：
   - 用户传输的文字、照片、视频、课件文件属于极度敏感隐私资产。
   - **绝对禁止**在后端服务器磁盘上创建持久化临时目录（如历史遗留的 `./wechat_media/`、`./notes/`）。
   - 全链路采用 V8 内存 Stream 直传，传输完成后主动填零（Wipe Buffer），避免 Dump 内存取证风险。

2. **多租户数据强隔离（Strict Multi-Tenant Sandbox）**：
   - 彻底摒弃单例全局变量共享。
   - 每个用户接入时分配独立哈希 `tenantId`，注入独立的 `TenantContext` 沙箱。
   - 所有的凭证存储、心跳状态、备忘录列表均限定在租户沙箱内部，物理杜绝横向越权（CWE-639）。

3. **凭证脱敏与纵深防护（Credential Vault Protection）**：
   - 前端 Web 界面绝对不接触真实的 Apple ID 账号密码及原始 Cookie。
   - 生产环境中凭证采用 **AES-256-GCM** 算法加密存储。
   - 传输层强制启用 TLS 1.3 强加密，防中间人劫持。

4. **主动心跳与掉线熔断（Real Probe & Circuit Breaking）**：
   - 针对微信协议，实时检测腾讯 iLink 返回码；一旦捕获到 `-14` 会话超时，立刻使凭证失效，主动通知前端进入重新扫码流程。
   - 针对 iCloud 协议，定期检测 Apple `validate` 接口；一旦捕获到 `HTTP 421 / 401`，立刻切断同步，杜绝静默失败与假在线。

---

## 2. 自主知识产权（IP）保护与合规

1. **核心算法与协议自主化封装**：
   - 备忘录原生 Attachment 大图嵌入逻辑（包含尺寸计算、UTI 分配、CloudKit Asset 令牌申请与 modify 请求），完全在项目内部以自有业务代码实现，无外部黑盒侵权风险。
   - 云盘分块上传协议通过标准 HTTP REST 实现，算法清晰透明。
2. **防逆向工程**：
   - 前端采用瘦客户端（Thin-Client）设计，仅做状态展示与操作派发。
   - 核心分流算法、双模状态机、CloudKit 协议解析全部保留在后端密室，避免商业逻辑泄露。
