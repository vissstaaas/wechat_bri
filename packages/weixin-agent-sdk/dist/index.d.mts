//#region src/messaging/markdown.d.ts
type OutputFormat = "plain" | "markdown";
//#endregion
//#region src/agent/interface.d.ts
interface Agent {
  /** Process a single message and return a reply. */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Clear/reset the session for a given conversation. */
  clearSession?(conversationId: string): void;
}
interface ChatRequest {
  /** Lossless provider message identifier. */
  messageId?: string;
  /** Resolved quote, also included in text for existing agents. */
  quote?: {
    messageId?: string;
    text: string;
    partialText?: string;
    media?: ChatRequest["media"];
    missing?: boolean;
  };
  /** Conversation / user identifier. Use this to maintain per-user context. */
  conversationId: string;
  /** Text content of the message. */
  text: string;
  /** Attached media file (image, audio, video, or generic file). */
  media?: {
    type: "image" | "audio" | "video" | "file"; /** Local file path (already downloaded and decrypted). */
    filePath: string; /** MIME type, e.g. "image/jpeg", "audio/wav". */
    mimeType: string; /** Original filename (available for file attachments). */
    fileName?: string;
  };
}
interface ChatResponse {
  /** Override the bot's default output format for this response. */
  outputFormat?: OutputFormat;
  /** Reply text, formatted according to outputFormat (plain by default). */
  text?: string;
  /** Reply media file. */
  media?: {
    type: "image" | "video" | "file"; /** Local file path or HTTPS URL. */
    url: string; /** Filename hint (for file attachments). */
    fileName?: string;
  };
}
//#endregion
//#region src/auth/login-qr.d.ts
type VerifyCodeRequest = {
  retry: boolean;
  signal: AbortSignal;
};
type VerifyCodeHandler = (request: VerifyCodeRequest) => string | Promise<string>;
//#endregion
//#region src/messaging/quote-store.d.ts
type QuoteCachePolicy = {
  enabled: boolean;
  retentionMs: number;
  maxMessagesPerAccount: number;
  mediaRetentionMs: number;
  maxMediaBytesPerAccount: number;
  maxSingleMediaBytes: number;
};
type QuoteMessageRecord = {
  accountId: string;
  conversationId: string;
  messageId: string;
  direction: "inbound" | "outbound";
  body: string;
  mediaPath?: string;
  mediaMime?: string;
  mediaName?: string;
  mediaSize?: number;
  createdAt: number;
};
type QuoteMessageInput = Omit<QuoteMessageRecord, "mediaPath" | "mediaSize"> & {
  sourceMediaPath?: string;
};
type QuoteCacheOptions = {
  enabled?: boolean;
  retentionDays?: number;
  maxMessagesPerAccount?: number;
  mediaRetentionDays?: number;
  maxMediaBytesPerAccount?: number;
  maxSingleMediaBytes?: number;
};
declare class QuoteStore {
  private readonly db;
  private readonly mediaRoot;
  private policy;
  private gcRunning;
  private gcRequested;
  private gcScheduled;
  private closed;
  private readonly gcTimer;
  private constructor();
  static open(params: {
    policy: QuoteCachePolicy;
    rootDir: string;
    mediaRoot?: string;
  }): Promise<QuoteStore | null>;
  updatePolicy(policy: QuoteCachePolicy): void;
  private initializeSchema;
  find(accountId: string, conversationId: string, messageId: string): QuoteMessageRecord | null;
  put(input: QuoteMessageInput): Promise<void>;
  deleteAccount(accountId: string): void;
  private deleteMessage;
  private findMediaPath;
  private registerManagedMedia;
  private requestGc;
  runGc(now?: number): void;
  private listMedia;
  private expireOldMedia;
  private enforceMediaBudget;
  private detachMedia;
  private removeMediaIfOrphaned;
  private pruneOrphanMediaFiles;
  close(): void;
}
//#endregion
//#region src/messaging/outbound.d.ts
type OutboundContext = {
  accountId: string;
  conversationId: string;
};
type MessageHooks = {
  /** Return false to cancel, a response to replace, or void to leave unchanged. Hook errors fail open. */beforeSend?: (message: ChatResponse, context: OutboundContext) => ChatResponse | false | void | Promise<ChatResponse | false | void>; /** Called once after delivery succeeds or fails; observer errors do not affect delivery. */
  afterSend?: (event: OutboundContext & {
    message: ChatResponse;
    error?: unknown;
  }) => void | Promise<void>;
};
//#endregion
//#region src/bot.d.ts
type LoginOptions = {
  /** Called when WeChat requests the digits shown on the phone. Defaults to terminal input on a TTY. */onVerifyCode?: VerifyCodeHandler;
  abortSignal?: AbortSignal; /** Overall login deadline, including QR acquisition and verification (default 8 minutes). */
  timeoutMs?: number; /** Override the API base URL. */
  baseUrl?: string; /** Log callback (defaults to console.log). */
  log?: (msg: string) => void;
};
type StartOptions = {
  /** Plain text remains the default. */outputFormat?: OutputFormat;
  botAgent?: string;
  quoteCache?: QuoteCacheOptions;
  hooks?: MessageHooks; /** Account ID to use. Auto-selects the first registered account if omitted. */
  accountId?: string; /** AbortSignal to stop the bot. */
  abortSignal?: AbortSignal; /** Log callback (defaults to console.log). */
  log?: (msg: string) => void;
};
/**
 * Interactive QR-code login. Prints the QR code to the terminal and waits
 * for the user to scan it with WeChat.
 *
 * Returns the normalized account ID on success.
 */
declare function login(opts?: LoginOptions): Promise<string>;
/**
 * Remove all stored WeChat account credentials.
 */
declare function logout(opts?: {
  log?: (msg: string) => void;
}): void;
/**
 * Check whether at least one WeChat account is logged in and configured.
 */
declare function isLoggedIn(): boolean;
/**
 * A running bot instance — provides proactive messaging capability.
 *
 * - `sendMessage(text)` — send a text message to the logged-in user.
 * - `sendMessage(response)` — send a ChatResponse (text and/or media).
 */
declare class Bot {
  private readonly _accountId;
  private readonly _baseUrl;
  private readonly _cdnBaseUrl;
  private readonly _token?;
  private readonly _userId;
  private readonly _monitorPromise;
  private readonly _options;
  private readonly _quoteStore;
  /** @internal */
  constructor(params: {
    accountId: string;
    baseUrl: string;
    cdnBaseUrl: string;
    token?: string;
    userId: string;
    monitorPromise: Promise<void>;
    options?: StartOptions;
    quoteStore?: Promise<QuoteStore | null>;
  });
  /**
   * Wait until the background WeChat monitor stops.
   *
   * This is useful for CLI programs that should keep running until the bot is
   * aborted, and for surfacing unrecoverable monitor errors to the caller.
   */
  wait(): Promise<void>;
  /**
   * Proactively send a message to the logged-in WeChat user.
   *
   * Accepts either a plain string (sent as text) or a full `ChatResponse`
   * object (text and/or media).
   *
   * Requires a context token from an inbound message. Tokens are restored
   * across restarts; expiration is determined by the WeChat server.
   */
  sendMessage(message: string | ChatResponse): Promise<void>;
}
/**
 * Start the bot — long-polls for new messages and dispatches them to the agent.
 *
 * Returns a `Bot` instance immediately. Use `bot.wait()` when a CLI program
 * should block until the background monitor stops.
 */
declare function start(agent: Agent, opts?: StartOptions): Bot;
//#endregion
export { type Agent, Bot, type ChatRequest, type ChatResponse, type LoginOptions, type MessageHooks, type OutboundContext, type OutputFormat, type QuoteCacheOptions, type StartOptions, type VerifyCodeHandler, type VerifyCodeRequest, isLoggedIn, login, logout, start };