import crypto from "crypto";

/**
 * Standard Unified Message Envelope
 * All inbound channels (WeChat, TG, DingTalk, Feishu) convert messages to this format.
 * Sinks (iCloud Notes, Drive, Photos, Notion) consume this format.
 */
export class MessageEnvelope {
  constructor({
    id = crypto.randomUUID(),
    tenantId = "default",
    sourceChannel = "wechat",
    fromUserId = "",
    text = "",
    mediaStream = null, // In-memory streaming buffer (zero disk drop)
    mediaMeta = null,   // { fileName, mimeType, size, ext, uti, width, height }
    timestamp = Date.now(),
    intent = null
  } = {}) {
    this.id = id;
    this.tenantId = tenantId;
    this.sourceChannel = sourceChannel;
    this.fromUserId = fromUserId;
    this.text = (text || "").trim();
    this.mediaStream = mediaStream;
    this.mediaMeta = mediaMeta;
    this.timestamp = timestamp;
    this.intent = intent;
  }

  hasMedia() {
    return Boolean(this.mediaStream && this.mediaMeta);
  }
}
