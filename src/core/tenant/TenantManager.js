/**
 * Multi-Tenant Isolated Sandbox (TenantContext)
 * Each user has their own independent WeChat channel, iCloud session, rules and status.
 */
export class TenantContext {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();

    // Independent WeChat Channel State
    this.wechat = {
      status: "DISCONNECTED", // "ONLINE" | "EXPIRED" | "WAIT_SCAN" | "DISCONNECTED"
      connected: false,
      accountId: null,
      userId: null,
      token: null,
      baseUrl: "https://ilinkai.weixin.qq.com",
      mode: "DUAL_AUTO",
      lastProbeAt: 0,
      errorMessage: ""
    };

    // Independent Apple iCloud State
    this.icloud = {
      status: "DISCONNECTED", // "ONLINE" | "EXPIRED" | "DISCONNECTED"
      connected: false,
      appleId: null,
      dsid: null,
      sessionCookie: null,
      ckUrl: null,
      driveUrl: null,
      docUrl: null,
      lastValidateAt: 0,
      noteCount: 0,
      attachmentCount: 0,
      errorMessage: ""
    };

    // Dynamic Vault Rules for this specific user
    this.rules = [
      {
        id: "key",
        title: "🔑 账号与重要速查",
        fileName: "🔑 账号与重要速查.md",
        keywords: ["密码", "账号", "户号", "卡号", "身份证", "密钥", "token", "key", "pin", "验证码", "学号", "wifi"],
        siriPrompt: "“嘿 Siri，查一下我备忘录里的账号密码”",
        isTodo: false
      },
      {
        id: "todo",
        title: "☑️ 待办与取件码",
        fileName: "☑️ 待办与取件码.md",
        keywords: ["明天", "后天", "下午", "上午", "晚上", "点半", "取件码", "快递", "丰巢", "买", "交", "记得", "todo"],
        siriPrompt: "“嘿 Siri，我备忘录里有什么待办和取件码？”",
        isTodo: true
      },
      {
        id: "link",
        title: "🔗 链接与稍后读",
        fileName: "🔗 链接与稍后读.md",
        keywords: ["http://", "https://", "www.", "github.com", "文章", "链接", "稍后读"],
        siriPrompt: "“嘿 Siri，我备忘录里存了什么网页链接？”",
        isTodo: false
      },
      {
        id: "idea",
        title: "💡 灵感与随手记",
        fileName: "💡 灵感与随手记.md",
        keywords: ["灵感", "想法", "随笔", "摘录", "总结", "笔记"],
        siriPrompt: "“嘿 Siri，念一下我备忘录里最新记的灵感”",
        isTodo: false
      }
    ];

    this.logs = [];

    this.lastClassification = {
      text: "明天下午4点去丰巢拿顺丰快递 取件码 5-2-1088",
      category: "todo",
      categoryName: "☑️ 待办与取件码.md",
      modeUsed: "NOTE_ARCHIVE",
      agentReply: "✅ 已自动归入《☑️ 待办与取件码》并同步至 iPhone 备忘录\n🎙️ 随时对 iPhone 喊：“嘿 Siri，我备忘录里有什么待办和取件码？”",
      latencyMs: 38,
      probabilities: { key: 0.05, todo: 0.88, link: 0.02, idea: 0.05 }
    };
  }

  touch() {
    this.lastActiveAt = Date.now();
  }

  addLog(tag, message) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    this.logs.unshift({ time, tag, message });
    if (this.logs.length > 50) this.logs.pop();
  }
}

class TenantManagerSingleton {
  constructor() {
    this.tenants = new Map();
  }

  getTenant(tenantId = "default") {
    if (!this.tenants.has(tenantId)) {
      this.tenants.set(tenantId, new TenantContext(tenantId));
    }
    const tenant = this.tenants.get(tenantId);
    tenant.touch();
    return tenant;
  }
}

export const tenantManager = new TenantManagerSingleton();
