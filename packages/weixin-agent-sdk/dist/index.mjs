import { createInterface } from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto, { createCipheriv, createDecipheriv, randomUUID } from "node:crypto";
import fs$1 from "node:fs/promises";
//#region src/storage/state-dir.ts
/** Resolve the OpenClaw state directory (mirrors core logic in src/infra). */
function resolveStateDir() {
	return process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
}
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
/** Normalize an account ID to a filesystem-safe string. */
function normalizeAccountId(raw) {
	return raw.trim().toLowerCase().replace(/[@.]/g, "-");
}
/**
* Pattern-based reverse of normalizeWeixinAccountId for known weixin ID suffixes.
* Used only as a compatibility fallback when loading accounts / sync bufs stored
* under the old raw ID.
* e.g. "b0f5860fdecb-im-bot" → "b0f5860fdecb@im.bot"
*/
function deriveRawAccountId(normalizedId) {
	if (normalizedId.endsWith("-im-bot")) return `${normalizedId.slice(0, -7)}@im.bot`;
	if (normalizedId.endsWith("-im-wechat")) return `${normalizedId.slice(0, -10)}@im.wechat`;
}
function resolveWeixinStateDir() {
	return path.join(resolveStateDir(), "openclaw-weixin");
}
function resolveAccountIndexPath() {
	return path.join(resolveWeixinStateDir(), "accounts.json");
}
/** Returns all accountIds registered via QR login. */
function listIndexedWeixinAccountIds() {
	const filePath = resolveAccountIndexPath();
	try {
		if (!fs.existsSync(filePath)) return [];
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id) => typeof id === "string" && id.trim() !== "");
	} catch {
		return [];
	}
}
/** Register accountId as the sole account in the persistent index. */
function registerWeixinAccountId(accountId) {
	const dir = resolveWeixinStateDir();
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify([accountId], null, 2), "utf-8");
}
function resolveAccountsDir$1() {
	return path.join(resolveWeixinStateDir(), "accounts");
}
function resolveAccountPath(accountId) {
	return path.join(resolveAccountsDir$1(), `${accountId}.json`);
}
/**
* Legacy single-file token: `credentials/openclaw-weixin/credentials.json` (pre per-account files).
*/
function loadLegacyToken() {
	const legacyPath = path.join(resolveStateDir(), "credentials", "openclaw-weixin", "credentials.json");
	try {
		if (!fs.existsSync(legacyPath)) return void 0;
		const raw = fs.readFileSync(legacyPath, "utf-8");
		const parsed = JSON.parse(raw);
		return typeof parsed.token === "string" ? parsed.token : void 0;
	} catch {
		return;
	}
}
function readAccountFile(filePath) {
	try {
		if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {}
	return null;
}
/** Load account data by ID, with compatibility fallbacks. */
function loadWeixinAccount(accountId) {
	const primary = readAccountFile(resolveAccountPath(accountId));
	if (primary) return primary;
	const rawId = deriveRawAccountId(accountId);
	if (rawId) {
		const compat = readAccountFile(resolveAccountPath(rawId));
		if (compat) return compat;
	}
	const token = loadLegacyToken();
	if (token) return { token };
	return null;
}
/**
* Persist account data after QR login (merges into existing file).
* - token: overwritten when provided.
* - baseUrl: stored when non-empty; resolveWeixinAccount falls back to DEFAULT_BASE_URL.
* - userId: set when `update.userId` is provided; omitted from file when cleared to empty.
*/
function saveWeixinAccount(accountId, update) {
	const dir = resolveAccountsDir$1();
	fs.mkdirSync(dir, { recursive: true });
	const existing = loadWeixinAccount(accountId) ?? {};
	const token = update.token?.trim() || existing.token;
	const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
	const userId = update.userId !== void 0 ? update.userId.trim() || void 0 : existing.userId?.trim() || void 0;
	const data = {
		...token ? {
			token,
			savedAt: (/* @__PURE__ */ new Date()).toISOString()
		} : {},
		...baseUrl ? { baseUrl } : {},
		...userId ? { userId } : {}
	};
	const filePath = resolveAccountPath(accountId);
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
	try {
		fs.chmodSync(filePath, 384);
	} catch {}
}
/** Remove account data file. */
function clearWeixinAccount(accountId) {
	try {
		fs.unlinkSync(resolveAccountPath(accountId));
	} catch {}
}
/** Remove all account data files and clear the account index. */
function clearAllWeixinAccounts() {
	const ids = listIndexedWeixinAccountIds();
	for (const id of ids) clearWeixinAccount(id);
	try {
		fs.writeFileSync(resolveAccountIndexPath(), "[]", "utf-8");
	} catch {}
}
/**
* Resolve the openclaw.json config file path.
* Checks OPENCLAW_CONFIG env var, then state dir.
*/
function resolveConfigPath() {
	const envPath = process.env.OPENCLAW_CONFIG?.trim();
	if (envPath) return envPath;
	return path.join(resolveStateDir(), "openclaw.json");
}
/**
* Read `routeTag` from openclaw.json (for callers without an `OpenClawConfig` object).
* Checks per-account `channels.<id>.accounts[accountId].routeTag` first, then section-level
* `channels.<id>.routeTag`. Matches `feat_weixin_extension` behavior; channel key is `"openclaw-weixin"`.
*/
function loadConfigRouteTag(accountId) {
	try {
		const configPath = resolveConfigPath();
		if (!fs.existsSync(configPath)) return void 0;
		const raw = fs.readFileSync(configPath, "utf-8");
		const section = JSON.parse(raw).channels?.["openclaw-weixin"];
		if (!section) return void 0;
		if (accountId) {
			const tag = section.accounts?.[accountId]?.routeTag;
			if (typeof tag === "number") return String(tag);
			if (typeof tag === "string" && tag.trim()) return tag.trim();
		}
		if (typeof section.routeTag === "number") return String(section.routeTag);
		return typeof section.routeTag === "string" && section.routeTag.trim() ? section.routeTag.trim() : void 0;
	} catch {
		return;
	}
}
/** List accountIds from the index file (written at QR login). */
function listWeixinAccountIds() {
	return listIndexedWeixinAccountIds();
}
/** Resolve a weixin account by ID, reading stored credentials. */
function resolveWeixinAccount(accountId) {
	const raw = accountId?.trim();
	if (!raw) throw new Error("weixin: accountId is required (no default account)");
	const id = normalizeAccountId(raw);
	const accountData = loadWeixinAccount(id);
	const token = accountData?.token?.trim() || void 0;
	return {
		accountId: id,
		baseUrl: accountData?.baseUrl?.trim() || "https://ilinkai.weixin.qq.com",
		cdnBaseUrl: CDN_BASE_URL,
		token,
		enabled: true,
		configured: Boolean(token)
	};
}
//#endregion
//#region package.json
var version = "0.6.0";
//#endregion
//#region src/util/logger.ts
/**
* Plugin logger — writes JSON lines to the main openclaw log file:
*   <tmpdir>/openclaw/openclaw-YYYY-MM-DD.log
* Same file and format used by all other channels.
*/
const MAIN_LOG_DIR = path.join(os.tmpdir(), "openclaw");
const SUBSYSTEM = "gateway/channels/openclaw-weixin";
const RUNTIME = "node";
const RUNTIME_VERSION = process.versions.node;
const HOSTNAME = os.hostname() || "unknown";
const PARENT_NAMES = ["openclaw"];
/** tslog-compatible level IDs (higher = more severe). */
const LEVEL_IDS = {
	TRACE: 1,
	DEBUG: 2,
	INFO: 3,
	WARN: 4,
	ERROR: 5,
	FATAL: 6
};
const DEFAULT_LOG_LEVEL = "INFO";
function resolveMinLevel() {
	const env = process.env.OPENCLAW_LOG_LEVEL?.toUpperCase();
	if (env && env in LEVEL_IDS) return LEVEL_IDS[env];
	return LEVEL_IDS[DEFAULT_LOG_LEVEL];
}
let minLevelId = resolveMinLevel();
/** Shift a Date into local time so toISOString() renders local clock digits. */
function toLocalISO(now) {
	const offsetMs = -now.getTimezoneOffset() * 6e4;
	const sign = offsetMs >= 0 ? "+" : "-";
	const abs = Math.abs(now.getTimezoneOffset());
	const offStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
	return new Date(now.getTime() + offsetMs).toISOString().replace("Z", offStr);
}
function localDateKey(now) {
	return toLocalISO(now).slice(0, 10);
}
function resolveMainLogPath() {
	const dateKey = localDateKey(/* @__PURE__ */ new Date());
	return path.join(MAIN_LOG_DIR, `openclaw-${dateKey}.log`);
}
let logDirEnsured = false;
function buildLoggerName(accountId) {
	return accountId ? `${SUBSYSTEM}/${accountId}` : SUBSYSTEM;
}
function writeLog(level, message, accountId) {
	if ((LEVEL_IDS[level] ?? LEVEL_IDS.INFO) < minLevelId) return;
	const now = /* @__PURE__ */ new Date();
	const loggerName = buildLoggerName(accountId);
	const prefixedMessage = accountId ? `[${accountId}] ${message}` : message;
	const entry = JSON.stringify({
		"0": loggerName,
		"1": prefixedMessage,
		_meta: {
			runtime: RUNTIME,
			runtimeVersion: RUNTIME_VERSION,
			hostname: HOSTNAME,
			name: loggerName,
			parentNames: PARENT_NAMES,
			date: now.toISOString(),
			logLevelId: LEVEL_IDS[level] ?? LEVEL_IDS.INFO,
			logLevelName: level
		},
		time: toLocalISO(now)
	});
	try {
		if (!logDirEnsured) {
			fs.mkdirSync(MAIN_LOG_DIR, { recursive: true });
			logDirEnsured = true;
		}
		fs.appendFileSync(resolveMainLogPath(), `${entry}\n`, "utf-8");
	} catch {}
}
/** Creates a logger instance, optionally bound to a specific account. */
function createLogger(accountId) {
	return {
		info(message) {
			writeLog("INFO", message, accountId);
		},
		debug(message) {
			writeLog("DEBUG", message, accountId);
		},
		warn(message) {
			writeLog("WARN", message, accountId);
		},
		error(message) {
			writeLog("ERROR", message, accountId);
		},
		withAccount(id) {
			return createLogger(id);
		},
		getLogFilePath() {
			return resolveMainLogPath();
		},
		close() {}
	};
}
const logger = createLogger();
//#endregion
//#region src/util/redact.ts
const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;
/**
* Truncate a string, appending a length indicator when trimmed.
* Returns `""` for empty/undefined input.
*/
function truncate(s, max) {
	if (!s) return "";
	if (s.length <= max) return s;
	return `${s.slice(0, max)}…(len=${s.length})`;
}
/**
* Redact a token/secret: show only the first few chars + total length.
* Returns `"(none)"` when absent.
*/
function redactToken(token, prefixLen = DEFAULT_TOKEN_PREFIX_LEN) {
	if (!token) return "(none)";
	if (token.length <= prefixLen) return `****(len=${token.length})`;
	return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}
/**
* Truncate a JSON body string to `maxLen` chars for safe logging.
* Appends original length so the reader knows how much was dropped.
*/
function redactBody(body, maxLen = DEFAULT_BODY_MAX_LEN) {
	if (!body) return "(empty)";
	try {
		body = JSON.stringify(JSON.parse(body), (key, value) => /token|aes.?key|verify.?code|qrcode|encrypt_query_param/i.test(key) ? "[redacted]" : value);
	} catch {
		return `[non-JSON body, ${body.length} chars]`;
	}
	return truncate(body, maxLen);
}
/**
* Strip query string (which often contains signatures/tokens) from a URL,
* keeping only origin + pathname.
*/
function redactUrl(rawUrl) {
	try {
		const u = new URL(rawUrl);
		const base = `${u.origin}${u.pathname}`;
		return u.search ? `${base}?<redacted>` : base;
	} catch {
		return truncate(rawUrl, 80);
	}
}
//#endregion
//#region src/api/api.ts
const CHANNEL_VERSION = version ?? "unknown";
/** Application identifier used by the iLink bot protocol. */
const ILINK_APP_ID = "bot";
/**
* iLink-App-ClientVersion: uint32 encoded as 0x00MMNNPP
* High 8 bits fixed to 0; remaining bits: major<<16 | minor<<8 | patch.
* e.g. "1.0.11" -> 0x0001000B = 65547
*/
function buildClientVersion(version) {
	const parts = version.split(".").map((p) => parseInt(p, 10));
	const major = parts[0] ?? 0;
	const minor = parts[1] ?? 0;
	const patch = parts[2] ?? 0;
	return (major & 255) << 16 | (minor & 255) << 8 | patch & 255;
}
const ILINK_APP_CLIENT_VERSION = buildClientVersion(version ?? "0.0.0");
/**
* Default `bot_agent` value used when the upstream app does not declare one.
* Identifies this SDK when the caller does not provide a product name/version.
*/
const DEFAULT_BOT_AGENT = `weixin-agent-sdk/${version}`;
/** Maximum length (bytes) of the sanitized `bot_agent` string. */
const BOT_AGENT_MAX_LEN = 256;
/**
* Sanitize a user-supplied `botAgent` config value into a wire-safe string.
*
* Grammar (UA-style):
*   bot_agent = product *( SP product )
*   product   = name "/" version [ SP "(" comment ")" ]
*   name      = 1*32( ALPHA / DIGIT / "_" / "." / "-" )
*   version   = 1*32( ALPHA / DIGIT / "_" / "." / "+" / "-" )
*   comment   = 1*64( printable ASCII minus "(" ")" )
*
* Tokens that fail to parse are dropped silently (no partial tokens kept).
* Returns `DEFAULT_BOT_AGENT` when the input is empty / all tokens dropped /
* the result exceeds the length cap after truncation.
*/
function sanitizeBotAgent(raw) {
	if (!raw || typeof raw !== "string") return DEFAULT_BOT_AGENT;
	const trimmed = raw.trim();
	if (!trimmed) return DEFAULT_BOT_AGENT;
	const productRe = /^[A-Za-z0-9_.\-]{1,32}\/[A-Za-z0-9_.+\-]{1,32}$/;
	const commentCharRe = /^[\x20-\x27\x2A-\x7E]{1,64}$/;
	const rawTokens = trimmed.split(/\s+/);
	const tokens = [];
	for (let i = 0; i < rawTokens.length; i += 1) {
		const tok = rawTokens[i];
		if (tok.startsWith("(") && !tok.endsWith(")")) {
			let acc = tok;
			while (i + 1 < rawTokens.length && !acc.endsWith(")")) {
				i += 1;
				acc += " " + rawTokens[i];
			}
			tokens.push(acc);
		} else tokens.push(tok);
	}
	const accepted = [];
	let pendingProduct = null;
	for (const tok of tokens) {
		if (tok.startsWith("(") && tok.endsWith(")")) {
			const inner = tok.slice(1, -1);
			if (pendingProduct && commentCharRe.test(inner)) {
				accepted.push(`${pendingProduct} (${inner})`);
				pendingProduct = null;
			} else if (pendingProduct) {
				accepted.push(pendingProduct);
				pendingProduct = null;
			}
			continue;
		}
		if (pendingProduct) {
			accepted.push(pendingProduct);
			pendingProduct = null;
		}
		if (productRe.test(tok)) pendingProduct = tok;
	}
	if (pendingProduct) accepted.push(pendingProduct);
	if (accepted.length === 0) return DEFAULT_BOT_AGENT;
	const joined = accepted.join(" ");
	if (Buffer.byteLength(joined, "utf-8") <= BOT_AGENT_MAX_LEN) return joined;
	const truncated = [];
	let len = 0;
	for (const t of accepted) {
		const add = (truncated.length === 0 ? 0 : 1) + Buffer.byteLength(t, "utf-8");
		if (len + add > BOT_AGENT_MAX_LEN) break;
		truncated.push(t);
		len += add;
	}
	return truncated.length > 0 ? truncated.join(" ") : DEFAULT_BOT_AGENT;
}
/** Build the `base_info` payload included in every API request. */
function buildBaseInfo(botAgent) {
	return {
		channel_version: CHANNEL_VERSION,
		bot_agent: sanitizeBotAgent(botAgent)
	};
}
/** Default timeout for long-poll getUpdates requests. */
const DEFAULT_LONG_POLL_TIMEOUT_MS$1 = 35e3;
/** Default timeout for regular API requests (sendMessage, getUploadUrl). */
const DEFAULT_API_TIMEOUT_MS = 15e3;
/** Default timeout for lightweight API requests (getConfig, sendTyping). */
const DEFAULT_CONFIG_TIMEOUT_MS = 1e4;
function ensureTrailingSlash(url) {
	return url.endsWith("/") ? url : `${url}/`;
}
/** X-WECHAT-UIN header: random uint32 -> decimal string -> base64. */
function randomWechatUin() {
	const uint32 = crypto.randomBytes(4).readUInt32BE(0);
	return Buffer.from(String(uint32), "utf-8").toString("base64");
}
/** Build headers shared by both GET and POST requests. */
function buildCommonHeaders() {
	const headers = {
		"iLink-App-Id": ILINK_APP_ID,
		"iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION)
	};
	const routeTag = loadConfigRouteTag();
	if (routeTag) headers.SKRouteTag = routeTag;
	return headers;
}
function buildHeaders(opts) {
	const headers = {
		"Content-Type": "application/json",
		AuthorizationType: "ilink_bot_token",
		"X-WECHAT-UIN": randomWechatUin(),
		...buildCommonHeaders()
	};
	if (opts.token?.trim()) headers.Authorization = `Bearer ${opts.token.trim()}`;
	logger.debug(`requestHeaders: ${JSON.stringify({
		...headers,
		Authorization: headers.Authorization ? "Bearer ***" : void 0
	})}`);
	return headers;
}
/**
* Classify a fetch-level error into a category for logging / diagnostics.
* This does NOT cover HTTP-level errors (4xx/5xx) — those are thrown separately.
*/
function classifyFetchError(err) {
	if (err instanceof Error && err.name === "AbortError") return {
		type: "timeout",
		description: "request timeout"
	};
	const cause = err?.cause;
	const causeCode = cause?.code ?? "";
	const causeStr = String(cause ?? err ?? "") + " " + String(causeCode);
	const matchedCode = causeCode || (typeof cause === "string" ? cause : "");
	if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(causeStr)) return {
		type: "dns",
		description: "DNS resolution failed, check DNS configuration",
		...matchedCode ? { code: matchedCode } : {}
	};
	if (/ECONNREFUSED/i.test(causeStr)) return {
		type: "tcp",
		description: "TCP connection refused",
		...matchedCode ? { code: matchedCode } : {}
	};
	if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(causeStr)) return {
		type: "tcp",
		description: "TCP connection timeout or unreachable",
		...matchedCode ? { code: matchedCode } : {}
	};
	if (/UND_ERR_SOCKET|SSL|TLS|CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(causeStr)) return {
		type: "tls",
		description: "TLS handshake error",
		...matchedCode ? { code: matchedCode } : {}
	};
	return {
		type: "unknown",
		description: "network request failed"
	};
}
/**
* GET fetch wrapper: send a GET request to a Weixin API endpoint.
* When `timeoutMs` is set, the request is aborted after that many milliseconds.
* Query parameters should already be encoded in `endpoint`.
* Returns the raw response text on success; throws on HTTP error or (if used) timeout abort.
*/
async function apiGetFetch(params) {
	const base = ensureTrailingSlash(params.baseUrl);
	const url = new URL(params.endpoint, base);
	const hdrs = buildCommonHeaders();
	logger.debug(`GET ${redactUrl(url.toString())}`);
	const timeoutMs = params.timeoutMs;
	const controller = timeoutMs != null && timeoutMs > 0 ? new AbortController() : void 0;
	const t = controller != null && timeoutMs != null ? setTimeout(() => controller.abort(), timeoutMs) : void 0;
	try {
		const res = await fetch(url.toString(), {
			method: "GET",
			headers: hdrs,
			signal: params.abortSignal ? AbortSignal.any([params.abortSignal, ...controller ? [controller.signal] : []]) : controller?.signal
		});
		const rawText = await res.text();
		if (t !== void 0) clearTimeout(t);
		logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
		if (!res.ok) throw new Error(`${params.label} HTTP ${res.status}`);
		return rawText;
	} catch (err) {
		if (t !== void 0) clearTimeout(t);
		const classified = classifyFetchError(err);
		logger.error(`${params.label}: GET fetch failed url=${redactUrl(url.toString())} timeoutMs=${timeoutMs ?? "none"} type=${classified.type} description=${classified.description}${classified.code ? ` code=${classified.code}` : ""} error=${String(err)}`);
		throw err;
	}
}
/**
* Combine an internal timeout controller with an optional external abort signal.
* This lets gateway channel-stop aborts cancel in-flight long-poll requests
* immediately while preserving the existing timeout-driven AbortError path.
*/
function combineAbortSignals(params) {
	const { internal, external } = params;
	if (!external) return {
		signal: internal?.signal,
		cleanup: () => {}
	};
	if (!internal) return {
		signal: external,
		cleanup: () => {}
	};
	if (external.aborted) {
		internal.abort();
		return {
			signal: internal.signal,
			cleanup: () => {}
		};
	}
	const onExternalAbort = () => internal.abort();
	external.addEventListener("abort", onExternalAbort, { once: true });
	return {
		signal: internal.signal,
		cleanup: () => external.removeEventListener("abort", onExternalAbort)
	};
}
/**
* Common fetch wrapper: POST JSON to a Weixin API endpoint.
* When `timeoutMs` is provided, the request is aborted after that many milliseconds.
* When omitted, no client-side timeout is applied (relies on OS/TCP stack).
* Returns the raw response text on success; throws on HTTP error or timeout.
*
* When `abortSignal` is provided, an external abort (e.g. gateway channel stop)
* cancels the in-flight request immediately instead of waiting for `timeoutMs`.
*/
async function apiPostFetch(params) {
	const base = ensureTrailingSlash(params.baseUrl);
	const url = new URL(params.endpoint, base);
	const hdrs = buildHeaders({ token: params.token });
	logger.debug(`POST ${redactUrl(url.toString())} body=${redactBody(params.body)}`);
	const controller = params.timeoutMs !== void 0 ? new AbortController() : void 0;
	const t = controller != null && params.timeoutMs !== void 0 ? setTimeout(() => controller.abort(), params.timeoutMs) : void 0;
	const { signal, cleanup } = combineAbortSignals({
		internal: controller,
		external: params.abortSignal
	});
	try {
		const res = await fetch(url.toString(), {
			method: "POST",
			headers: hdrs,
			body: params.body,
			...signal ? { signal } : {}
		});
		const rawText = await res.text();
		if (t !== void 0) clearTimeout(t);
		logger.debug(`${params.label} status=${res.status} raw=${redactBody(rawText)}`);
		if (!res.ok) throw new Error(`${params.label} HTTP ${res.status}`);
		return rawText;
	} catch (err) {
		if (t !== void 0) clearTimeout(t);
		const classified = classifyFetchError(err);
		logger.error(`${params.label}: POST fetch failed url=${redactUrl(url.toString())} timeoutMs=${params.timeoutMs ?? "none"} type=${classified.type} description=${classified.description}${classified.code ? ` code=${classified.code}` : ""} error=${String(err)}`);
		throw err;
	} finally {
		cleanup();
	}
}
/**
* Long-poll getUpdates. Server should hold the request until new messages or timeout.
*
* On client-side timeout (no server response within timeoutMs), returns an empty response
* with ret=0 so the caller can simply retry. This is normal for long-poll.
*/
async function getUpdates(params) {
	const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS$1;
	try {
		return parseWeixinApiJson(await apiPostFetch({
			baseUrl: params.baseUrl,
			endpoint: "ilink/bot/getupdates",
			body: JSON.stringify({
				get_updates_buf: params.get_updates_buf ?? "",
				base_info: buildBaseInfo(params.botAgent)
			}),
			token: params.token,
			timeoutMs: timeout,
			label: "getUpdates",
			abortSignal: params.abortSignal
		}));
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			if (params.abortSignal?.aborted) logger.debug(`getUpdates: aborted by external signal`);
			else logger.debug(`getUpdates: client-side timeout after ${timeout}ms, returning empty response`);
			return {
				ret: 0,
				msgs: [],
				get_updates_buf: params.get_updates_buf
			};
		}
		throw err;
	}
}
/** Get a pre-signed CDN upload URL for a file. */
async function getUploadUrl(params) {
	const rawText = await apiPostFetch({
		baseUrl: params.baseUrl,
		endpoint: "ilink/bot/getuploadurl",
		body: JSON.stringify({
			filekey: params.filekey,
			media_type: params.media_type,
			to_user_id: params.to_user_id,
			rawsize: params.rawsize,
			rawfilemd5: params.rawfilemd5,
			filesize: params.filesize,
			thumb_rawsize: params.thumb_rawsize,
			thumb_rawfilemd5: params.thumb_rawfilemd5,
			thumb_filesize: params.thumb_filesize,
			no_need_thumb: params.no_need_thumb,
			aeskey: params.aeskey,
			base_info: buildBaseInfo(params.botAgent)
		}),
		token: params.token,
		timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
		label: "getUploadUrl"
	});
	return JSON.parse(rawText);
}
const LOSSLESS_ID_FIELDS = new Set([
	"message_id",
	"msg_id",
	"svr_id"
]);
/**
* Quote uint64 message identifiers before JSON.parse sees them. This scanner
* only rewrites actual object properties, never matching text inside JSON strings.
*/
function parseWeixinApiJson(rawText) {
	let output = "";
	let index = 0;
	while (index < rawText.length) {
		if (rawText[index] !== "\"") {
			output += rawText[index++];
			continue;
		}
		const stringStart = index;
		index++;
		let escaped = false;
		while (index < rawText.length) {
			const char = rawText[index++];
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") break;
		}
		const stringToken = rawText.slice(stringStart, index);
		output += stringToken;
		let cursor = index;
		while (/\s/.test(rawText[cursor] ?? "")) cursor++;
		if (rawText[cursor] !== ":") continue;
		let key;
		try {
			key = JSON.parse(stringToken);
		} catch {
			continue;
		}
		if (typeof key !== "string" || !LOSSLESS_ID_FIELDS.has(key)) continue;
		output += rawText.slice(index, cursor + 1);
		cursor++;
		while (/\s/.test(rawText[cursor] ?? "")) output += rawText[cursor++];
		const numberStart = cursor;
		if (rawText[cursor] === "-") cursor++;
		while (/\d/.test(rawText[cursor] ?? "")) cursor++;
		if (cursor > numberStart && !(cursor === numberStart + 1 && rawText[numberStart] === "-")) {
			output += `"${rawText.slice(numberStart, cursor)}"`;
			index = cursor;
		} else index = numberStart;
	}
	return JSON.parse(output);
}
/** Send a single message downstream and return the server-assigned message ID. */
async function sendMessage(params) {
	const resp = parseWeixinApiJson(await apiPostFetch({
		baseUrl: params.baseUrl,
		endpoint: "ilink/bot/sendmessage",
		body: JSON.stringify({
			...params.body,
			base_info: buildBaseInfo(params.botAgent)
		}),
		token: params.token,
		timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
		label: "sendMessage"
	}));
	if (resp.ret && resp.ret !== 0) throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? "(none)"}`);
	return resp;
}
/** Fetch bot config (includes typing_ticket) for a given user. */
async function getConfig(params) {
	const rawText = await apiPostFetch({
		baseUrl: params.baseUrl,
		endpoint: "ilink/bot/getconfig",
		body: JSON.stringify({
			ilink_user_id: params.ilinkUserId,
			context_token: params.contextToken,
			base_info: buildBaseInfo(params.botAgent)
		}),
		token: params.token,
		timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
		label: "getConfig"
	});
	return JSON.parse(rawText);
}
/** Send a typing indicator to a user. */
async function sendTyping(params) {
	await apiPostFetch({
		baseUrl: params.baseUrl,
		endpoint: "ilink/bot/sendtyping",
		body: JSON.stringify({
			...params.body,
			base_info: buildBaseInfo(params.botAgent)
		}),
		token: params.token,
		timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
		label: "sendTyping"
	});
}
/**
* Notify Weixin that this channel client is stopping (gateway shutdown / channel stop).
* Uses a standalone timeout (not the gateway abort signal) so the request can finish
* after OpenClaw has already aborted the long-poll.
*/
async function notifyStop(params) {
	const rawText = await apiPostFetch({
		baseUrl: params.baseUrl,
		endpoint: "ilink/bot/msg/notifystop",
		body: JSON.stringify({ base_info: buildBaseInfo(params.botAgent) }),
		token: params.token,
		timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
		label: "notifyStop"
	});
	return JSON.parse(rawText);
}
/**
* Notify Weixin that this channel client is starting (gateway startup / channel start).
*/
async function notifyStart(params) {
	const rawText = await apiPostFetch({
		baseUrl: params.baseUrl,
		endpoint: "ilink/bot/msg/notifystart",
		body: JSON.stringify({ base_info: buildBaseInfo(params.botAgent) }),
		token: params.token,
		timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
		label: "notifyStart",
		abortSignal: params.abortSignal
	});
	return JSON.parse(rawText);
}
//#endregion
//#region src/auth/login-qr.ts
const ACTIVE_LOGIN_TTL_MS = 5 * 6e4;
/** Client-side timeout for the long-poll get_qrcode_status request. */
const QR_LONG_POLL_TIMEOUT_MS = 35e3;
/** Fixed API base URL for all QR code requests. */
const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";
const activeLogins = /* @__PURE__ */ new Map();
function isLoginFresh(login) {
	return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}
/** Remove all expired entries from the activeLogins map to prevent memory leaks. */
function purgeExpiredLogins() {
	for (const [id, login] of activeLogins) if (!isLoginFresh(login)) activeLogins.delete(id);
}
/** 获取本地已登录账号的 bot token 列表，最多返回最新的 10 个。 */
function getLocalBotTokenList() {
	const accountIds = listIndexedWeixinAccountIds();
	const tokens = [];
	for (let i = accountIds.length - 1; i >= 0 && tokens.length < 10; i--) {
		const token = loadWeixinAccount(accountIds[i])?.token?.trim();
		if (token) tokens.push(token);
	}
	return tokens;
}
async function fetchQRCode(apiBaseUrl, botType, abortSignal) {
	logger.info(`NewFetching QR code from: ${apiBaseUrl} bot_type=${botType}`);
	const localTokenList = getLocalBotTokenList();
	logger.info(`newfetchQRCode: local_token_list count=${localTokenList.length}`);
	const rawText = await apiPostFetch({
		baseUrl: apiBaseUrl,
		endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
		body: JSON.stringify({ local_token_list: localTokenList }),
		abortSignal,
		label: "fetchQRCode"
	});
	return JSON.parse(rawText);
}
/** Stop waiting for application input when login is cancelled or expires. */
async function readVerifyCode(handler, request) {
	if (!handler) throw new Error("登录需要验证码，请通过 onVerifyCode 提供手机微信显示的数字");
	request.signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const abort = () => reject(request.signal.reason);
		request.signal.addEventListener("abort", abort, { once: true });
		Promise.resolve().then(() => handler(request)).then((code) => {
			if (!code.trim()) throw new Error("验证码不能为空");
			resolve(code.trim());
		}).catch(reject).finally(() => request.signal.removeEventListener("abort", abort));
	});
}
async function pollQRStatus(apiBaseUrl, qrcode, verifyCode, abortSignal) {
	logger.debug(`Long-poll QR status from: ${apiBaseUrl} qrcode=***`);
	try {
		let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
		if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
		const rawText = await apiGetFetch({
			baseUrl: apiBaseUrl,
			endpoint,
			timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
			abortSignal,
			label: "pollQRStatus"
		});
		return JSON.parse(rawText);
	} catch (err) {
		abortSignal?.throwIfAborted();
		if (err instanceof Error && err.name === "AbortError") {
			logger.debug(`pollQRStatus: client-side timeout after ${QR_LONG_POLL_TIMEOUT_MS}ms, returning wait`);
			return { status: "wait" };
		}
		logger.warn(`pollQRStatus: network/gateway error, will retry: ${String(err)}`);
		return { status: "wait" };
	}
}
/**
* 在终端展示二维码及备用链接。
* 供 CLI 登录流程和 MCP Tool 登录流程共同复用。
*/
async function displayQRCode(qrcodeUrl) {
	try {
		(await import("qrcode-terminal")).default.generate(qrcodeUrl, { small: true });
		process.stdout.write(`若二维码未能显示或无法使用，你可以访问以下链接以继续：\n`);
		process.stdout.write(`${qrcodeUrl}\n`);
	} catch {
		process.stdout.write(`若二维码未能显示或无法使用，你可以访问以下链接以继续：\n`);
		process.stdout.write(`${qrcodeUrl}\n`);
	}
}
async function startWeixinLoginWithQr(opts) {
	const sessionKey = opts.accountId || randomUUID();
	purgeExpiredLogins();
	const existing = activeLogins.get(sessionKey);
	if (!opts.force && existing && isLoginFresh(existing) && existing.qrcodeUrl) return {
		qrcodeUrl: existing.qrcodeUrl,
		message: "二维码已显示，请用手机微信扫描。",
		sessionKey
	};
	try {
		const botType = opts.botType || "3";
		logger.info(`Starting Weixin login with bot_type=${botType}`);
		const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType, opts.abortSignal);
		logger.info(`QR code received, qrcode=${redactToken(qrResponse.qrcode)} imgContentLen=${qrResponse.qrcode_img_content?.length ?? 0}`);
		logger.info(`二维码链接: ${qrResponse.qrcode_img_content}`);
		const login = {
			sessionKey,
			id: randomUUID(),
			qrcode: qrResponse.qrcode,
			qrcodeUrl: qrResponse.qrcode_img_content,
			startedAt: Date.now()
		};
		activeLogins.set(sessionKey, login);
		return {
			qrcodeUrl: qrResponse.qrcode_img_content,
			message: "用手机微信扫描以下二维码，以继续连接：",
			sessionKey
		};
	} catch (err) {
		logger.error(`Failed to start Weixin login: ${String(err)}`);
		return {
			message: `Failed to start login: ${String(err)}`,
			sessionKey
		};
	}
}
const MAX_QR_REFRESH_COUNT = 3;
/**
* 刷新二维码并展示给用户，返回是否成功。
* 成功时更新 activeLogin 的 qrcode/qrcodeUrl/startedAt，并重置 scannedPrinted。
*/
async function refreshQRCode(activeLogin, botType, qrRefreshCount, onScannedReset, abortSignal) {
	process.stdout.write(`\n⏳ 正在刷新二维码...(${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
	logger.info(`waitForWeixinLogin: refreshing QR code (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`);
	try {
		const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType, abortSignal);
		activeLogin.qrcode = qrResponse.qrcode;
		activeLogin.qrcodeUrl = qrResponse.qrcode_img_content;
		activeLogin.startedAt = Date.now();
		onScannedReset();
		logger.info(`waitForWeixinLogin: new QR code obtained qrcode=${redactToken(qrResponse.qrcode)}`);
		process.stdout.write(`🔄 二维码已更新，请重新扫描。\n\n`);
		await displayQRCode(qrResponse.qrcode_img_content);
		return { success: true };
	} catch (refreshErr) {
		logger.error(`waitForWeixinLogin: failed to refresh QR code: ${String(refreshErr)}`);
		return {
			success: false,
			message: `刷新二维码失败: ${String(refreshErr)}`
		};
	}
}
async function waitForWeixinLogin(opts) {
	let activeLogin = activeLogins.get(opts.sessionKey);
	if (!activeLogin) {
		logger.warn(`waitForWeixinLogin: no active login sessionKey=${opts.sessionKey}`);
		return {
			connected: false,
			message: "当前没有进行中的登录，请先发起登录。"
		};
	}
	if (!isLoginFresh(activeLogin)) {
		logger.warn(`waitForWeixinLogin: login QR expired sessionKey=${opts.sessionKey}`);
		activeLogins.delete(opts.sessionKey);
		return {
			connected: false,
			message: "二维码已过期，请重新生成。"
		};
	}
	const timeoutMs = Math.max(opts.timeoutMs ?? 48e4, 1e3);
	const deadline = Date.now() + timeoutMs;
	const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...opts.abortSignal ? [opts.abortSignal] : []]);
	let scannedPrinted = false;
	let qrRefreshCount = 1;
	let verifyAttempts = 0;
	activeLogin.currentApiBaseUrl = FIXED_BASE_URL;
	logger.info("Starting to poll QR code status...");
	while (Date.now() < deadline) {
		try {
			signal.throwIfAborted();
			const statusResponse = await pollQRStatus(activeLogin.currentApiBaseUrl ?? FIXED_BASE_URL, activeLogin.qrcode, activeLogin.pendingVerifyCode, signal);
			logger.debug(`pollQRStatus: status=${statusResponse.status} hasBotToken=${Boolean(statusResponse.bot_token)} hasBotId=${Boolean(statusResponse.ilink_bot_id)}`);
			activeLogin.status = statusResponse.status;
			switch (statusResponse.status) {
				case "wait":
					if (opts.verbose) process.stdout.write(".");
					break;
				case "scaned":
					if (activeLogin.pendingVerifyCode) {
						logger.info("verify code accepted, resuming polling");
						activeLogin.pendingVerifyCode = void 0;
					}
					if (!scannedPrinted) {
						process.stdout.write("\n正在验证\n");
						scannedPrinted = true;
					}
					break;
				case "need_verifycode":
					if (++verifyAttempts > 3) throw new Error("验证码重试次数已达上限，请重新登录");
					activeLogin.pendingVerifyCode = await readVerifyCode(opts.onVerifyCode, {
						retry: Boolean(activeLogin.pendingVerifyCode),
						signal
					});
					continue;
				case "expired": {
					qrRefreshCount++;
					if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
						logger.warn(`waitForWeixinLogin: QR expired ${MAX_QR_REFRESH_COUNT} times, giving up sessionKey=${opts.sessionKey}`);
						activeLogins.delete(opts.sessionKey);
						return {
							connected: false,
							message: "二维码多次失效，连接流程已停止。请稍后再试。"
						};
					}
					process.stdout.write(`\n⏳ 二维码已过期，正在刷新...\n`);
					const expiredRefreshResult = await refreshQRCode(activeLogin, opts.botType || "3", qrRefreshCount, () => {
						scannedPrinted = false;
					}, signal);
					if (!expiredRefreshResult.success) {
						activeLogins.delete(opts.sessionKey);
						return {
							connected: false,
							message: expiredRefreshResult.message
						};
					}
					break;
				}
				case "verify_code_blocked": {
					logger.warn(`waitForWeixinLogin: verify code blocked, qrRefreshCount=${qrRefreshCount} sessionKey=${opts.sessionKey}`);
					process.stdout.write("\n⛔ 多次输入错误，请稍后再试。\n");
					activeLogin.pendingVerifyCode = void 0;
					qrRefreshCount++;
					if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
						logger.warn(`waitForWeixinLogin: verify_code_blocked and QR refresh limit reached, giving up sessionKey=${opts.sessionKey}`);
						activeLogins.delete(opts.sessionKey);
						return {
							connected: false,
							message: "多次输入错误，连接流程已停止。请稍后再试。"
						};
					}
					const blockedRefreshResult = await refreshQRCode(activeLogin, opts.botType || "3", qrRefreshCount, () => {
						scannedPrinted = false;
					}, signal);
					if (!blockedRefreshResult.success) {
						activeLogins.delete(opts.sessionKey);
						return {
							connected: false,
							message: blockedRefreshResult.message
						};
					}
					break;
				}
				case "binded_redirect":
					logger.info(`waitForWeixinLogin: binded_redirect received, bot already bound sessionKey=${opts.sessionKey}`);
					process.stdout.write("\n✅ 已连接过此 OpenClaw，无需重复连接。\n");
					activeLogins.delete(opts.sessionKey);
					return {
						connected: false,
						alreadyConnected: true,
						accountId: statusResponse.ilink_bot_id,
						message: "已连接过此 OpenClaw，无需重复连接。"
					};
				case "scaned_but_redirect": {
					const redirectHost = statusResponse.redirect_host;
					if (redirectHost) {
						activeLogin.currentApiBaseUrl = `https://${redirectHost}`;
						logger.info(`waitForWeixinLogin: IDC redirect, switching polling host to ${redirectHost}`);
					} else logger.warn(`waitForWeixinLogin: received scaned_but_redirect but redirect_host is missing, continuing with current host`);
					break;
				}
				case "confirmed":
					if (!statusResponse.ilink_bot_id) {
						activeLogins.delete(opts.sessionKey);
						logger.error("Login confirmed but ilink_bot_id missing from response");
						return {
							connected: false,
							message: "登录失败：服务器未返回 ilink_bot_id。"
						};
					}
					activeLogin.botToken = statusResponse.bot_token;
					activeLogins.delete(opts.sessionKey);
					logger.info(`✅ Login confirmed! ilink_bot_id=${statusResponse.ilink_bot_id} ilink_user_id=${redactToken(statusResponse.ilink_user_id)}`);
					return {
						connected: true,
						botToken: statusResponse.bot_token,
						accountId: statusResponse.ilink_bot_id,
						baseUrl: statusResponse.baseurl,
						userId: statusResponse.ilink_user_id,
						message: "已将此 OpenClaw 连接到微信。"
					};
			}
		} catch (err) {
			logger.error(`Error polling QR status: ${String(err)}`);
			activeLogins.delete(opts.sessionKey);
			return {
				connected: false,
				message: `Login failed: ${String(err)}`
			};
		}
		try {
			await import("node:timers/promises").then(({ setTimeout }) => setTimeout(1e3, void 0, { signal }));
		} catch {
			break;
		}
	}
	logger.warn(`waitForWeixinLogin: timed out waiting for QR scan sessionKey=${opts.sessionKey} timeoutMs=${timeoutMs}`);
	activeLogins.delete(opts.sessionKey);
	return {
		connected: false,
		message: "登录超时，请重试。"
	};
}
//#endregion
//#region src/util/random.ts
/**
* Generate a prefixed unique ID using timestamp + crypto random bytes.
* Format: `{prefix}:{timestamp}-{8-char hex}`
*/
function generateId(prefix) {
	return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}
/**
* Generate a temporary file name with random suffix.
* Format: `{prefix}-{timestamp}-{8-char hex}{ext}`
*/
function tempFileName(prefix, ext) {
	return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}
//#endregion
//#region src/api/types.ts
/** proto: UploadMediaType */
const UploadMediaType = {
	IMAGE: 1,
	VIDEO: 2,
	FILE: 3,
	VOICE: 4
};
const MessageType = {
	NONE: 0,
	USER: 1,
	BOT: 2
};
const MessageItemType = {
	NONE: 0,
	TEXT: 1,
	IMAGE: 2,
	VOICE: 3,
	FILE: 4,
	VIDEO: 5
};
const MessageState = {
	NEW: 0,
	GENERATING: 1,
	FINISH: 2
};
/** Typing status: 1 = typing (default), 2 = cancel typing. */
const TypingStatus = {
	TYPING: 1,
	CANCEL: 2
};
//#endregion
//#region src/messaging/context-tokens.ts
const accounts = /* @__PURE__ */ new Map();
function tokenFile(accountId) {
	return path.join(resolveStateDir(), "openclaw-weixin", "accounts", `${encodeURIComponent(accountId)}.context-tokens.json`);
}
function restoreContextTokens(accountId) {
	const file = tokenFile(accountId);
	const existing = accounts.get(file);
	if (existing) return existing;
	const tokens = /* @__PURE__ */ new Map();
	try {
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		if (data && typeof data === "object" && !Array.isArray(data)) {
			for (const [user, token] of Object.entries(data)) if (typeof token === "string" && token) tokens.set(user, token);
		}
	} catch (err) {
		if (err.code !== "ENOENT") logger.warn("context tokens: unable to read cache; waiting for new inbound messages");
	}
	accounts.set(file, tokens);
	return tokens;
}
function getContextToken(accountId, userId) {
	return restoreContextTokens(accountId).get(userId);
}
function setContextToken(accountId, userId, token) {
	const tokens = restoreContextTokens(accountId);
	tokens.set(userId, token);
	const file = tokenFile(accountId);
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		fs.mkdirSync(path.dirname(file), {
			recursive: true,
			mode: 448
		});
		fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(tokens)), { mode: 384 });
		fs.renameSync(temporary, file);
	} catch {
		logger.warn("context tokens: unable to persist cache; keeping tokens in memory");
	} finally {
		try {
			fs.rmSync(temporary, { force: true });
		} catch {}
	}
}
function clearContextTokensForAccount(accountId) {
	accounts.delete(tokenFile(accountId));
	fs.rmSync(tokenFile(accountId), { force: true });
}
//#endregion
//#region src/messaging/inbound.ts
/** Returns true if the message item is a media type (image, video, file, or voice). */
function isMediaItem(item) {
	return item.type === MessageItemType.IMAGE || item.type === MessageItemType.VIDEO || item.type === MessageItemType.FILE || item.type === MessageItemType.VOICE;
}
function bodyFromItemList(itemList) {
	if (!itemList?.length) return "";
	for (const item of itemList) {
		if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
			const text = String(item.text_item.text);
			const ref = item.ref_msg;
			if (!ref) return text;
			if (ref.message_item && isMediaItem(ref.message_item)) return text;
			const parts = [];
			if (ref.title) parts.push(ref.title);
			if (ref.message_item) {
				const refBody = bodyFromItemList([ref.message_item]);
				if (refBody) parts.push(refBody);
			}
			if (!parts.length) return text;
			return `[引用: ${parts.join(" | ")}]\n${text}`;
		}
		if (item.type === MessageItemType.VOICE && item.voice_item?.text) return item.voice_item.text;
	}
	return "";
}
//#endregion
//#region src/cdn/aes-ecb.ts
/**
* Shared AES-128-ECB crypto utilities for CDN upload and download.
*/
/** Encrypt buffer with AES-128-ECB (PKCS7 padding is default). */
function encryptAesEcb(plaintext, key) {
	const cipher = createCipheriv("aes-128-ecb", key, null);
	return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
/** Decrypt buffer with AES-128-ECB (PKCS7 padding). */
function decryptAesEcb(ciphertext, key) {
	const decipher = createDecipheriv("aes-128-ecb", key, null);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
/** Compute AES-128-ECB ciphertext size (PKCS7 padding to 16-byte boundary). */
function aesEcbPaddedSize(plaintextSize) {
	return Math.ceil((plaintextSize + 1) / 16) * 16;
}
//#endregion
//#region src/cdn/cdn-url.ts
/**
* Unified CDN URL construction for Weixin CDN upload/download.
*/
/** Build a CDN download URL from encrypt_query_param. */
function buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl) {
	return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}
/** Build a CDN upload URL from upload_param and filekey. */
function buildCdnUploadUrl(params) {
	return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}
//#endregion
//#region src/cdn/cdn-upload.ts
/** Maximum retry attempts for CDN upload. */
const UPLOAD_MAX_RETRIES = 3;
/**
* Upload one buffer to the Weixin CDN with AES-128-ECB encryption.
* Returns the download encrypted_query_param from the CDN response.
* Retries up to UPLOAD_MAX_RETRIES times on server errors; client errors (4xx) abort immediately.
*/
async function uploadBufferToCdn(params) {
	const { buf, uploadFullUrl, uploadParam, filekey, cdnBaseUrl, label, aeskey } = params;
	const ciphertext = encryptAesEcb(buf, aeskey);
	const trimmedFull = uploadFullUrl?.trim();
	let cdnUrl;
	if (trimmedFull) cdnUrl = trimmedFull;
	else if (uploadParam) cdnUrl = buildCdnUploadUrl({
		cdnBaseUrl,
		uploadParam,
		filekey
	});
	else throw new Error(`${label}: CDN upload URL missing (need upload_full_url or upload_param)`);
	logger.debug(`${label}: CDN POST url=${redactUrl(cdnUrl)} ciphertextSize=${ciphertext.length}`);
	let downloadParam;
	let lastError;
	for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) try {
		const res = await fetch(cdnUrl, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream" },
			body: new Uint8Array(ciphertext)
		});
		if (res.status >= 400 && res.status < 500) {
			const errMsg = res.headers.get("x-error-message") ?? await res.text();
			logger.error(`${label}: CDN client error attempt=${attempt} status=${res.status} errMsg=${errMsg}`);
			throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
		}
		if (res.status !== 200) {
			const errMsg = res.headers.get("x-error-message") ?? `status ${res.status}`;
			logger.error(`${label}: CDN server error attempt=${attempt} status=${res.status} errMsg=${errMsg}`);
			throw new Error(`CDN upload server error: ${errMsg}`);
		}
		downloadParam = res.headers.get("x-encrypted-param") ?? void 0;
		if (!downloadParam) {
			logger.error(`${label}: CDN response missing x-encrypted-param header attempt=${attempt}`);
			throw new Error("CDN upload response missing x-encrypted-param header");
		}
		logger.debug(`${label}: CDN upload success attempt=${attempt}`);
		break;
	} catch (err) {
		lastError = err;
		const diagnostic = classifyFetchError(err);
		logger.error(`${label}: CDN request failed url=${redactUrl(cdnUrl)} type=${diagnostic.type} code=${diagnostic.code ?? "none"}`);
		if (err instanceof Error && err.message.includes("client error")) throw err;
		if (attempt < UPLOAD_MAX_RETRIES) logger.error(`${label}: attempt ${attempt} failed, retrying... err=${String(err)}`);
		else logger.error(`${label}: all ${UPLOAD_MAX_RETRIES} attempts failed err=${String(err)}`);
	}
	if (!downloadParam) throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
	return { downloadParam };
}
//#endregion
//#region src/media/mime.ts
const EXTENSION_TO_MIME = {
	".pdf": "application/pdf",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".txt": "text/plain",
	".csv": "text/csv",
	".zip": "application/zip",
	".tar": "application/x-tar",
	".gz": "application/gzip",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp"
};
const MIME_TO_EXTENSION = {
	"image/jpeg": ".jpg",
	"image/jpg": ".jpg",
	"image/png": ".png",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/bmp": ".bmp",
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"video/webm": ".webm",
	"video/x-matroska": ".mkv",
	"video/x-msvideo": ".avi",
	"audio/mpeg": ".mp3",
	"audio/ogg": ".ogg",
	"audio/wav": ".wav",
	"application/pdf": ".pdf",
	"application/zip": ".zip",
	"application/x-tar": ".tar",
	"application/gzip": ".gz",
	"text/plain": ".txt",
	"text/csv": ".csv"
};
/** Get MIME type from filename extension. Returns "application/octet-stream" for unknown extensions. */
function getMimeFromFilename(filename) {
	return EXTENSION_TO_MIME[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}
/** Get file extension from MIME type. Returns ".bin" for unknown types. */
function getExtensionFromMime(mimeType) {
	return MIME_TO_EXTENSION[mimeType.split(";")[0].trim().toLowerCase()] ?? ".bin";
}
/** Get file extension from Content-Type header or URL path. Returns ".bin" for unknown. */
function getExtensionFromContentTypeOrUrl(contentType, url) {
	if (contentType) {
		const ext = getExtensionFromMime(contentType);
		if (ext !== ".bin") return ext;
	}
	const ext = path.extname(new URL(url).pathname).toLowerCase();
	return new Set(Object.keys(EXTENSION_TO_MIME)).has(ext) ? ext : ".bin";
}
//#endregion
//#region src/cdn/upload.ts
/**
* Download a remote media URL (image, video, file) to a local temp file in destDir.
* Returns the local file path; extension is inferred from Content-Type / URL.
*/
async function downloadRemoteImageToTemp(url, destDir) {
	logger.debug(`downloadRemoteImageToTemp: fetching url=${redactUrl(url)}`);
	const res = await fetch(url).catch((err) => {
		const diagnostic = classifyFetchError(err);
		logger.error(`remote media download failed url=${redactUrl(url)} type=${diagnostic.type} code=${diagnostic.code ?? "none"}`);
		throw err;
	});
	if (!res.ok) {
		const msg = `remote media download failed: ${res.status} ${res.statusText} url=${redactUrl(url)}`;
		logger.error(`downloadRemoteImageToTemp: ${msg}`);
		throw new Error(msg);
	}
	const buf = Buffer.from(await res.arrayBuffer());
	logger.debug(`downloadRemoteImageToTemp: downloaded ${buf.length} bytes`);
	await fs$1.mkdir(destDir, { recursive: true });
	const ext = getExtensionFromContentTypeOrUrl(res.headers.get("content-type"), url);
	const name = tempFileName("weixin-remote", ext);
	const filePath = path.join(destDir, name);
	await fs$1.writeFile(filePath, buf);
	logger.debug(`downloadRemoteImageToTemp: saved to ${filePath} ext=${ext}`);
	return filePath;
}
/**
* Common upload pipeline: read file → hash → gen aeskey → getUploadUrl → uploadBufferToCdn → return info.
*/
async function uploadMediaToCdn(params) {
	const { filePath, toUserId, opts, cdnBaseUrl, mediaType, label } = params;
	const plaintext = await fs$1.readFile(filePath);
	const rawsize = plaintext.length;
	const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
	const filesize = aesEcbPaddedSize(rawsize);
	const filekey = crypto.randomBytes(16).toString("hex");
	const aeskey = crypto.randomBytes(16);
	logger.debug(`${label}: file=${filePath} rawsize=${rawsize} filesize=${filesize} md5=${rawfilemd5} filekey=${filekey}`);
	const uploadUrlResp = await getUploadUrl({
		...opts,
		filekey,
		media_type: mediaType,
		to_user_id: toUserId,
		rawsize,
		rawfilemd5,
		filesize,
		no_need_thumb: true,
		aeskey: aeskey.toString("hex")
	});
	const uploadFullUrl = uploadUrlResp.upload_full_url?.trim();
	const uploadParam = uploadUrlResp.upload_param;
	if (!uploadFullUrl && !uploadParam) {
		logger.error(`${label}: getUploadUrl returned no upload URL (need upload_full_url or upload_param), resp=${JSON.stringify(uploadUrlResp)}`);
		throw new Error(`${label}: getUploadUrl returned no upload URL`);
	}
	const { downloadParam: downloadEncryptedQueryParam } = await uploadBufferToCdn({
		buf: plaintext,
		uploadFullUrl: uploadFullUrl || void 0,
		uploadParam: uploadParam ?? void 0,
		filekey,
		cdnBaseUrl,
		aeskey,
		label: `${label}[orig filekey=${filekey}]`
	});
	return {
		filekey,
		downloadEncryptedQueryParam,
		aeskey: aeskey.toString("hex"),
		fileSize: rawsize,
		fileSizeCiphertext: filesize
	};
}
/** Upload a local image file to the Weixin CDN with AES-128-ECB encryption. */
async function uploadFileToWeixin(params) {
	return uploadMediaToCdn({
		...params,
		mediaType: UploadMediaType.IMAGE,
		label: "uploadFileToWeixin"
	});
}
/** Upload a local video file to the Weixin CDN. */
async function uploadVideoToWeixin(params) {
	return uploadMediaToCdn({
		...params,
		mediaType: UploadMediaType.VIDEO,
		label: "uploadVideoToWeixin"
	});
}
/**
* Upload a local file attachment (non-image, non-video) to the Weixin CDN.
* Uses media_type=FILE; no thumbnail required.
*/
async function uploadFileAttachmentToWeixin(params) {
	return uploadMediaToCdn({
		...params,
		mediaType: UploadMediaType.FILE,
		label: "uploadFileAttachmentToWeixin"
	});
}
//#endregion
//#region src/messaging/markdown.ts
/** Find a matching delimiter, allowing nesting and Markdown escapes. */
function closingDelimiter(text, start, open, close) {
	let depth = 1;
	for (let i = start + 1; i < text.length; i++) if (text[i] === "\\") i++;
	else if (text[i] === open) depth++;
	else if (text[i] === close && --depth === 0) return i;
	return -1;
}
function readLink(text, start) {
	const image = text[start] === "!";
	const labelStart = start + (image ? 2 : 1);
	const labelEnd = closingDelimiter(text, labelStart - 1, "[", "]");
	if (labelEnd < 0 || text[labelEnd + 1] !== "(") return;
	let cursor = labelEnd + 2;
	while (/\s/.test(text[cursor] ?? "")) cursor++;
	let url;
	if (text[cursor] === "<") {
		const end = text.indexOf(">", cursor + 1);
		if (end < 0) return;
		url = text.slice(cursor + 1, end);
		cursor = end + 1;
	} else {
		const urlStart = cursor;
		while (cursor < text.length && !/[\s)]/.test(text[cursor])) if (text[cursor] === "\\") cursor += 2;
		else if (text[cursor] === "(") {
			const end = closingDelimiter(text, cursor, "(", ")");
			if (end < 0) return;
			cursor = end + 1;
		} else cursor++;
		url = text.slice(urlStart, cursor);
	}
	const tail = /^(?:\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)/.exec(text.slice(cursor));
	if (!tail) return;
	return {
		image,
		label: text.slice(labelStart, labelEnd),
		url: url.replace(/\\([\\()[\]])/g, "$1"),
		end: cursor + tail[0].length
	};
}
function markdownToPlainText(text) {
	return formatMessageText(text, "plain");
}
/** Keep supported Markdown or produce readable plain text, always protecting URLs. */
function formatMessageText(text, format = "plain") {
	let result = format === "markdown" ? text : text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim());
	let prefix = "";
	while (text.includes(prefix)) prefix += "";
	const values = [];
	const protect = (value) => `${prefix}${values.push(value) - 1}\uE001`;
	const tokens = /```[\s\S]*?(?:```|$)|`[^`\n]*`|!?\[|(?:[a-z][a-z\d+.-]*:\/\/|mailto:)[^\s<>`]+/gi;
	let output = "";
	let previousEnd = 0;
	for (let match; match = tokens.exec(result);) {
		const start = match.index;
		if (match[0].startsWith("`")) output += result.slice(previousEnd, start) + protect(format === "markdown" ? match[0] : match[0].slice(1, -1));
		else if (match[0].endsWith("[")) {
			const link = readLink(result, start);
			if (!link) continue;
			const label = markdownToPlainText(link.label);
			const value = format === "markdown" ? result.slice(start, link.end) : !label || label === link.url ? link.url : `${label}\n${link.url}`;
			output += result.slice(previousEnd, start) + (link.image ? "" : protect(value));
			tokens.lastIndex = link.end;
		} else {
			let url = match[0];
			const before = output + result.slice(previousEnd, start);
			const line = before.slice(before.lastIndexOf("\n") + 1);
			const openMarkers = /* @__PURE__ */ new Set();
			for (const marker of line.match(/\*{1,3}|_{1,3}|~~/g) ?? []) if (openMarkers.has(marker)) openMarkers.delete(marker);
			else openMarkers.add(marker);
			for (const marker of openMarkers) if (url.endsWith(marker)) {
				url = url.slice(0, -marker.length);
				tokens.lastIndex -= marker.length;
			}
			output += result.slice(previousEnd, start) + protect(url);
		}
		previousEnd = tokens.lastIndex;
	}
	result = output + result.slice(previousEnd);
	if (format === "markdown") {
		result = result.replace(/^( {0,3})#{5,6} /gm, "$1");
		const cjk = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
		result = result.replace(/(?<!\*)\*\*\*([^\n]+?)\*\*\*(?!\*)/g, (all, body) => cjk.test(body) ? body : all).replace(/(?<!_)___([^\n]+?)___(?!_)/g, (all, body) => cjk.test(body) ? body : all).replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, (all, body) => cjk.test(body) ? body : all).replace(/(?<!_)_(?!_)([^_\n]+?)_(?!_)/g, (all, body) => cjk.test(body) ? body : all);
	} else {
		result = result.replace(/^\|[\s:|-]+\|$/gm, "");
		result = result.replace(/^\|(.+)\|$/gm, (_, inner) => inner.split("|").map((cell) => cell.trim()).join("  "));
		result = result.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/_(.+?)_/g, "$1").replace(/~~(.+?)~~/g, "$1").replace(/`(.+?)`/g, "$1");
	}
	return result.replace(new RegExp(`${prefix}(\\d+)\uE001`, "g"), (_, index) => values[Number(index)]);
}
//#endregion
//#region src/messaging/send.ts
function generateClientId() {
	return generateId("openclaw-weixin");
}
/** Build a SendMessageReq containing a single text message. */
function buildTextMessageReq(params) {
	const { to, text, contextToken, clientId } = params;
	const item_list = text ? [{
		type: MessageItemType.TEXT,
		text_item: { text }
	}] : [];
	return { msg: {
		from_user_id: "",
		to_user_id: to,
		client_id: clientId,
		message_type: MessageType.BOT,
		message_state: MessageState.FINISH,
		item_list: item_list.length ? item_list : void 0,
		context_token: contextToken ?? void 0
	} };
}
/** Build a SendMessageReq from a text payload. */
function buildSendMessageReq(params) {
	const { to, contextToken, text, clientId } = params;
	return buildTextMessageReq({
		to,
		text,
		contextToken,
		clientId
	});
}
/**
* Send a plain text message downstream.
* contextToken is required for all reply sends; missing it breaks conversation association.
*/
async function sendMessageWeixin(params) {
	const { to, text, opts } = params;
	if (!opts.contextToken) {
		logger.error(`sendMessageWeixin: contextToken missing, refusing to send to=${to}`);
		throw new Error("sendMessageWeixin: contextToken is required");
	}
	const clientId = generateClientId();
	const req = buildSendMessageReq({
		to,
		contextToken: opts.contextToken,
		text,
		clientId
	});
	try {
		const response = await sendMessage({
			...opts,
			baseUrl: opts.baseUrl,
			token: opts.token,
			timeoutMs: opts.timeoutMs,
			body: req
		});
		await cacheSentMessage(opts, to, text, response.message_id, false);
		return {
			messageId: clientId,
			serverMessageId: response.message_id
		};
	} catch (err) {
		logger.error(`sendMessageWeixin: failed to=${to} clientId=${clientId} err=${String(err)}`);
		throw err;
	}
}
/**
* Send one or more MessageItems (optionally preceded by a text caption) downstream.
* Each item is sent as its own request so that item_list always has exactly one entry.
*/
async function sendMediaItems(params) {
	const { to, text, mediaItem, opts, label } = params;
	const items = [];
	if (text) items.push({
		type: MessageItemType.TEXT,
		text_item: { text }
	});
	items.push(mediaItem);
	let lastClientId = "";
	let serverMessageId;
	for (const item of items) {
		lastClientId = generateClientId();
		const req = { msg: {
			from_user_id: "",
			to_user_id: to,
			client_id: lastClientId,
			message_type: MessageType.BOT,
			message_state: MessageState.FINISH,
			item_list: [item],
			context_token: opts.contextToken ?? void 0
		} };
		try {
			const response = await sendMessage({
				...opts,
				baseUrl: opts.baseUrl,
				token: opts.token,
				timeoutMs: opts.timeoutMs,
				body: req
			});
			serverMessageId = response.message_id;
			await cacheSentMessage(opts, to, item.text_item?.text ?? "", response.message_id, item.type !== MessageItemType.TEXT);
		} catch (err) {
			logger.error(`${label}: failed to=${to} clientId=${lastClientId} err=${String(err)}`);
			throw err;
		}
	}
	logger.debug(`${label}: success to=${to} clientId=${lastClientId}`);
	return {
		messageId: lastClientId,
		serverMessageId
	};
}
/**
* Send an image message downstream using a previously uploaded file.
* Optionally include a text caption as a separate TEXT item before the image.
*
* ImageItem fields:
*   - media.encrypt_query_param: CDN download param
*   - media.aes_key: AES key, base64-encoded
*   - mid_size: original ciphertext file size
*/
async function sendImageMessageWeixin(params) {
	const { to, text, uploaded, opts } = params;
	if (!opts.contextToken) {
		logger.error(`sendImageMessageWeixin: contextToken missing, refusing to send to=${to}`);
		throw new Error("sendImageMessageWeixin: contextToken is required");
	}
	logger.debug(`sendImageMessageWeixin: to=${to} filekey=${uploaded.filekey} fileSize=${uploaded.fileSize} aeskey=present`);
	return sendMediaItems({
		to,
		text,
		mediaItem: {
			type: MessageItemType.IMAGE,
			image_item: {
				media: {
					encrypt_query_param: uploaded.downloadEncryptedQueryParam,
					aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
					encrypt_type: 1
				},
				mid_size: uploaded.fileSizeCiphertext
			}
		},
		opts,
		label: "sendImageMessageWeixin"
	});
}
/**
* Send a video message downstream using a previously uploaded file.
* VideoItem: media (CDN ref), video_size (ciphertext bytes).
* Includes an optional text caption sent as a separate TEXT item first.
*/
async function sendVideoMessageWeixin(params) {
	const { to, text, uploaded, opts } = params;
	if (!opts.contextToken) {
		logger.error(`sendVideoMessageWeixin: contextToken missing, refusing to send to=${to}`);
		throw new Error("sendVideoMessageWeixin: contextToken is required");
	}
	return sendMediaItems({
		to,
		text,
		mediaItem: {
			type: MessageItemType.VIDEO,
			video_item: {
				media: {
					encrypt_query_param: uploaded.downloadEncryptedQueryParam,
					aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
					encrypt_type: 1
				},
				video_size: uploaded.fileSizeCiphertext
			}
		},
		opts,
		label: "sendVideoMessageWeixin"
	});
}
/**
* Send a file attachment downstream using a previously uploaded file.
* FileItem: media (CDN ref), file_name, len (plaintext bytes as string).
* Includes an optional text caption sent as a separate TEXT item first.
*/
async function sendFileMessageWeixin(params) {
	const { to, text, fileName, uploaded, opts } = params;
	if (!opts.contextToken) {
		logger.error(`sendFileMessageWeixin: contextToken missing, refusing to send to=${to}`);
		throw new Error("sendFileMessageWeixin: contextToken is required");
	}
	return sendMediaItems({
		to,
		text,
		mediaItem: {
			type: MessageItemType.FILE,
			file_item: {
				media: {
					encrypt_query_param: uploaded.downloadEncryptedQueryParam,
					aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
					encrypt_type: 1
				},
				file_name: fileName,
				len: String(uploaded.fileSize)
			}
		},
		opts,
		label: "sendFileMessageWeixin"
	});
}
async function cacheSentMessage(opts, to, body, messageId, media) {
	if (!opts.quoteStore || !opts.accountId || !messageId) return;
	try {
		await opts.quoteStore.put({
			accountId: opts.accountId,
			conversationId: to,
			messageId,
			direction: "outbound",
			body: body || (media ? "[附件]" : ""),
			createdAt: Date.now(),
			...media ? {
				sourceMediaPath: opts.sourceMediaPath,
				mediaMime: opts.mediaMime,
				mediaName: opts.mediaName
			} : {}
		});
	} catch (err) {
		logger.warn(`Unable to cache sent message: ${String(err)}`);
	}
}
//#endregion
//#region src/messaging/send-media.ts
/**
* Upload a local file and send it as a weixin message, routing by MIME type:
*   video/*  → uploadVideoToWeixin        + sendVideoMessageWeixin
*   image/*  → uploadFileToWeixin         + sendImageMessageWeixin
*   else     → uploadFileAttachmentToWeixin + sendFileMessageWeixin
*
* Used by both the auto-reply deliver path (monitor.ts) and the outbound
* sendMedia path (channel.ts) so they stay in sync.
*/
async function sendWeixinMediaFile(params) {
	const { filePath, to, text, opts, cdnBaseUrl } = params;
	const mime = getMimeFromFilename(filePath);
	const uploadOpts = opts;
	const sendOpts = {
		...opts,
		sourceMediaPath: filePath,
		mediaMime: mime,
		mediaName: opts.mediaName ?? path.basename(filePath)
	};
	if (mime.startsWith("video/")) {
		logger.info(`[weixin] sendWeixinMediaFile: uploading video filePath=${filePath} to=${to}`);
		const uploaded = await uploadVideoToWeixin({
			filePath,
			toUserId: to,
			opts: uploadOpts,
			cdnBaseUrl
		});
		logger.info(`[weixin] sendWeixinMediaFile: video upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
		return sendVideoMessageWeixin({
			to,
			text,
			uploaded,
			opts: sendOpts
		});
	}
	if (mime.startsWith("image/")) {
		logger.info(`[weixin] sendWeixinMediaFile: uploading image filePath=${filePath} to=${to}`);
		const uploaded = await uploadFileToWeixin({
			filePath,
			toUserId: to,
			opts: uploadOpts,
			cdnBaseUrl
		});
		logger.info(`[weixin] sendWeixinMediaFile: image upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
		return sendImageMessageWeixin({
			to,
			text,
			uploaded,
			opts: sendOpts
		});
	}
	const fileName = opts.mediaName ?? path.basename(filePath);
	logger.info(`[weixin] sendWeixinMediaFile: uploading file attachment filePath=${filePath} name=${fileName} to=${to}`);
	const uploaded = await uploadFileAttachmentToWeixin({
		filePath,
		fileName,
		toUserId: to,
		opts: uploadOpts,
		cdnBaseUrl
	});
	logger.info(`[weixin] sendWeixinMediaFile: file upload done filekey=${uploaded.filekey} size=${uploaded.fileSize}`);
	return sendFileMessageWeixin({
		to,
		text,
		fileName,
		uploaded,
		opts: sendOpts
	});
}
//#endregion
//#region src/messaging/outbound.ts
async function sendChatResponse(response, deps) {
	const context = {
		accountId: deps.accountId,
		conversationId: deps.to
	};
	let message = response;
	try {
		const changed = await deps.hooks?.beforeSend?.({
			...response,
			media: response.media && { ...response.media }
		}, context);
		if (changed === false) return;
		if (changed) message = changed;
	} catch (err) {
		logger.warn(`beforeSend hook failed: ${String(err)}`);
	}
	let error;
	try {
		const text = formatMessageText(message.text ?? "", message.outputFormat ?? deps.outputFormat);
		if (message.media) {
			const url = message.media.url;
			await sendWeixinMediaFile({
				filePath: /^https?:\/\//.test(url) ? await downloadRemoteImageToTemp(url, path.join(os.tmpdir(), "weixin-agent/media/outbound")) : path.resolve(url),
				to: deps.to,
				text,
				cdnBaseUrl: deps.cdnBaseUrl,
				opts: {
					...deps.opts,
					mediaName: message.media.fileName
				}
			});
		} else if (text) await sendMessageWeixin({
			to: deps.to,
			text,
			opts: deps.opts
		});
		else throw new Error("消息必须包含 text 或 media");
	} catch (err) {
		error = err;
		throw err;
	} finally {
		try {
			await deps.hooks?.afterSend?.({
				...context,
				message,
				error
			});
		} catch (err) {
			logger.warn(`afterSend hook failed: ${String(err)}`);
		}
	}
}
//#endregion
//#region src/messaging/quote-store.ts
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_MESSAGES_PER_ACCOUNT = 1e4;
const DEFAULT_MEDIA_RETENTION_DAYS = 7;
const DEFAULT_MAX_MEDIA_BYTES_PER_ACCOUNT = 256 * 1024 * 1024;
const DEFAULT_MAX_SINGLE_MEDIA_BYTES = 25 * 1024 * 1024;
const GC_TIMER_MS = 3600 * 1e3;
function positiveNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function positiveInteger(value, fallback) {
	return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}
function resolveQuoteCachePolicy(quote) {
	return {
		enabled: quote?.enabled !== false,
		retentionMs: positiveNumber(quote?.retentionDays, DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1e3,
		maxMessagesPerAccount: positiveInteger(quote?.maxMessagesPerAccount, DEFAULT_MAX_MESSAGES_PER_ACCOUNT),
		mediaRetentionMs: positiveNumber(quote?.mediaRetentionDays, DEFAULT_MEDIA_RETENTION_DAYS) * 24 * 60 * 60 * 1e3,
		maxMediaBytesPerAccount: positiveInteger(quote?.maxMediaBytesPerAccount, DEFAULT_MAX_MEDIA_BYTES_PER_ACCOUNT),
		maxSingleMediaBytes: positiveInteger(quote?.maxSingleMediaBytes, DEFAULT_MAX_SINGLE_MEDIA_BYTES)
	};
}
function safePathSegment(raw) {
	const safe = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/\.\.+/g, "_");
	return safe && safe !== "." && safe !== ".." ? safe : "default";
}
function accountMediaDirName(accountId) {
	return `${safePathSegment(accountId).slice(0, 48)}-${crypto.createHash("sha256").update(accountId, "utf8").digest("hex").slice(0, 16)}`;
}
function quoteCacheRoot(accountId) {
	return path.join(resolveStateDir(), "weixin-agent-sdk", "quotes", accountMediaDirName(accountId));
}
function deleteQuoteCacheForAccount(accountId) {
	fs.rmSync(quoteCacheRoot(accountId), {
		recursive: true,
		force: true
	});
}
function asStoredRow(value) {
	if (!value || typeof value !== "object") return null;
	return value;
}
var QuoteStore = class QuoteStore {
	db;
	mediaRoot;
	policy;
	gcRunning = false;
	gcRequested = false;
	gcScheduled = false;
	closed = false;
	gcTimer;
	constructor(db, mediaRoot, policy) {
		this.db = db;
		this.mediaRoot = mediaRoot;
		this.policy = policy;
		this.initializeSchema();
		this.gcTimer = setInterval(() => this.requestGc(), GC_TIMER_MS);
		this.gcTimer.unref();
		this.runGc();
	}
	static async open(params) {
		if (!params.policy.enabled) return null;
		let opened;
		try {
			const sqlite = await import("node:sqlite");
			const rootDir = params.rootDir;
			const mediaRoot = params.mediaRoot ?? path.join(rootDir, "media");
			fs.mkdirSync(rootDir, {
				recursive: true,
				mode: 448
			});
			fs.mkdirSync(mediaRoot, {
				recursive: true,
				mode: 448
			});
			try {
				fs.chmodSync(rootDir, 448);
			} catch {}
			const dbPath = path.join(rootDir, "ref-messages.sqlite");
			const db = new sqlite.DatabaseSync(dbPath);
			opened = db;
			try {
				fs.chmodSync(dbPath, 384);
			} catch {}
			return new QuoteStore(db, mediaRoot, params.policy);
		} catch (err) {
			opened?.close();
			logger.warn(`quote cache disabled: node:sqlite is unavailable or the database could not be opened: ${String(err)}`);
			return null;
		}
	}
	updatePolicy(policy) {
		this.policy = policy;
		this.requestGc();
	}
	initializeSchema() {
		this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS quote_messages (
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        media_path TEXT,
        media_mime TEXT,
        media_name TEXT,
        media_size INTEGER,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, conversation_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS quote_messages_account_created
        ON quote_messages (account_id, created_at);
      CREATE INDEX IF NOT EXISTS quote_messages_media_path
        ON quote_messages (media_path);
    `);
	}
	find(accountId, conversationId, messageId) {
		if (this.closed || !messageId) return null;
		const row = asStoredRow(this.db.prepare(`
          SELECT account_id, conversation_id, message_id, direction, body,
                 media_path, media_mime, media_name, media_size, created_at
          FROM quote_messages
          WHERE account_id = ? AND conversation_id = ? AND message_id = ?
        `).get(accountId, conversationId, messageId));
		if (!row) return null;
		if (Date.now() - row.created_at > this.policy.retentionMs) {
			this.deleteMessage(accountId, conversationId, messageId);
			return null;
		}
		if (row.media_path && Date.now() - row.created_at > this.policy.mediaRetentionMs) {
			this.detachMedia(row.media_path);
			row.media_path = null;
		}
		return {
			accountId: row.account_id,
			conversationId: row.conversation_id,
			messageId: row.message_id,
			direction: row.direction,
			body: row.body,
			...row.media_path ? { mediaPath: row.media_path } : {},
			...row.media_mime ? { mediaMime: row.media_mime } : {},
			...row.media_name ? { mediaName: row.media_name } : {},
			...typeof row.media_size === "number" ? { mediaSize: row.media_size } : {},
			createdAt: row.created_at
		};
	}
	async put(input) {
		if (this.closed || !input.messageId || !input.body && !input.sourceMediaPath) return;
		const media = input.sourceMediaPath ? this.registerManagedMedia(input.accountId, input.sourceMediaPath, input.mediaMime) : null;
		this.db.prepare(`
        INSERT INTO quote_messages (
          account_id, conversation_id, message_id, direction, body,
          media_path, media_mime, media_name, media_size, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, conversation_id, message_id) DO UPDATE SET
          direction = excluded.direction,
          body = excluded.body,
          media_path = COALESCE(excluded.media_path, quote_messages.media_path),
          media_mime = COALESCE(excluded.media_mime, quote_messages.media_mime),
          media_name = COALESCE(excluded.media_name, quote_messages.media_name),
          media_size = COALESCE(excluded.media_size, quote_messages.media_size),
          created_at = excluded.created_at
      `).run(input.accountId, input.conversationId, input.messageId, input.direction, input.body, media?.path ?? null, input.mediaMime ?? media?.mime ?? null, input.mediaName ?? media?.name ?? null, media?.size ?? null, Number.isFinite(input.createdAt) && input.createdAt > 0 ? input.createdAt : Date.now());
		this.runGc();
	}
	deleteAccount(accountId) {
		if (this.closed) return;
		this.db.prepare("DELETE FROM quote_messages WHERE account_id = ?").run(accountId);
		const accountMediaDir = path.join(this.mediaRoot, accountMediaDirName(accountId));
		try {
			fs.rmSync(accountMediaDir, {
				recursive: true,
				force: true
			});
		} catch (err) {
			logger.warn(`quote cache: failed to remove media for account=${accountId}: ${String(err)}`);
		}
	}
	deleteMessage(accountId, conversationId, messageId) {
		const existing = this.findMediaPath(accountId, conversationId, messageId);
		this.db.prepare("DELETE FROM quote_messages WHERE account_id = ? AND conversation_id = ? AND message_id = ?").run(accountId, conversationId, messageId);
		if (existing) this.removeMediaIfOrphaned(existing);
	}
	findMediaPath(accountId, conversationId, messageId) {
		const row = this.db.prepare("SELECT media_path FROM quote_messages WHERE account_id = ? AND conversation_id = ? AND message_id = ?").get(accountId, conversationId, messageId);
		return typeof row?.media_path === "string" ? row.media_path : null;
	}
	registerManagedMedia(accountId, sourcePath, mime) {
		try {
			const stat = fs.statSync(sourcePath);
			if (!stat.isFile() || stat.size > this.policy.maxSingleMediaBytes) return null;
			const dir = path.join(this.mediaRoot, accountMediaDirName(accountId));
			fs.mkdirSync(dir, {
				recursive: true,
				mode: 448
			});
			const destination = path.join(dir, crypto.randomUUID() + path.extname(sourcePath));
			fs.copyFileSync(sourcePath, destination, fs.constants.COPYFILE_EXCL);
			fs.chmodSync(destination, 384);
			return {
				path: destination,
				mime,
				name: path.basename(sourcePath),
				size: stat.size
			};
		} catch (err) {
			logger.warn(`quote cache: failed to retain media: ${String(err)}`);
			return null;
		}
	}
	requestGc() {
		if (this.closed) return;
		if (this.gcRunning) {
			this.gcRequested = true;
			return;
		}
		if (this.gcScheduled) return;
		this.gcScheduled = true;
		queueMicrotask(() => {
			this.gcScheduled = false;
			this.runGc();
		});
	}
	runGc(now = Date.now()) {
		if (this.closed || this.gcRunning) {
			this.gcRequested = true;
			return;
		}
		this.gcRunning = true;
		try {
			const messageCutoff = now - this.policy.retentionMs;
			this.db.prepare("DELETE FROM quote_messages WHERE created_at < ?").run(messageCutoff);
			const accounts = this.db.prepare("SELECT DISTINCT account_id FROM quote_messages").all();
			for (const { account_id: accountId } of accounts) {
				this.db.prepare(`
            DELETE FROM quote_messages
            WHERE rowid IN (
              SELECT rowid FROM quote_messages
              WHERE account_id = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT -1 OFFSET ?
            )
          `).run(accountId, this.policy.maxMessagesPerAccount);
				this.expireOldMedia(accountId, now - this.policy.mediaRetentionMs);
				this.enforceMediaBudget(accountId);
			}
			this.pruneOrphanMediaFiles();
		} catch (err) {
			logger.warn(`quote cache GC failed: ${String(err)}`);
		} finally {
			this.gcRunning = false;
			if (this.gcRequested) {
				this.gcRequested = false;
				this.requestGc();
			}
		}
	}
	listMedia(accountId) {
		return this.db.prepare(`
        SELECT media_path, MAX(COALESCE(media_size, 0)) AS media_size,
               MAX(created_at) AS newest_at
        FROM quote_messages
        WHERE account_id = ? AND media_path IS NOT NULL
        GROUP BY media_path
        ORDER BY newest_at ASC
      `).all(accountId);
	}
	expireOldMedia(accountId, cutoff) {
		for (const media of this.listMedia(accountId)) {
			if (media.newest_at >= cutoff) continue;
			this.detachMedia(media.media_path);
		}
	}
	enforceMediaBudget(accountId) {
		const rows = this.listMedia(accountId);
		let total = rows.reduce((sum, row) => sum + Math.max(0, row.media_size), 0);
		for (const row of rows) {
			if (total <= this.policy.maxMediaBytesPerAccount) break;
			this.detachMedia(row.media_path);
			total -= Math.max(0, row.media_size);
		}
	}
	detachMedia(mediaPath) {
		this.db.prepare("UPDATE quote_messages SET media_path = NULL WHERE media_path = ?").run(mediaPath);
		this.removeMediaIfOrphaned(mediaPath);
	}
	removeMediaIfOrphaned(mediaPath) {
		if (this.db.prepare("SELECT 1 AS found FROM quote_messages WHERE media_path = ? LIMIT 1").get(mediaPath)?.found) return;
		try {
			fs.unlinkSync(mediaPath);
		} catch (err) {
			if (err.code !== "ENOENT") logger.warn(`quote cache: failed to remove media path=${mediaPath}: ${String(err)}`);
		}
	}
	pruneOrphanMediaFiles() {
		if (!fs.existsSync(this.mediaRoot)) return;
		const known = new Set(this.db.prepare("SELECT DISTINCT media_path FROM quote_messages WHERE media_path IS NOT NULL").all().map((row) => row.media_path));
		const visit = (dir) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) visit(fullPath);
				else if (entry.isFile() && !known.has(fullPath)) try {
					fs.unlinkSync(fullPath);
				} catch {}
			}
		};
		visit(this.mediaRoot);
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		clearInterval(this.gcTimer);
		this.db.close();
	}
};
//#endregion
//#region src/api/config-cache.ts
const CONFIG_CACHE_TTL_MS = 1440 * 60 * 1e3;
const CONFIG_CACHE_INITIAL_RETRY_MS = 2e3;
const CONFIG_CACHE_MAX_RETRY_MS = 3600 * 1e3;
/**
* Per-user getConfig cache with periodic random refresh (within 24h) and
* exponential-backoff retry (up to 1h) on failure.
*/
var WeixinConfigManager = class {
	cache = /* @__PURE__ */ new Map();
	constructor(apiOpts, log) {
		this.apiOpts = apiOpts;
		this.log = log;
	}
	async getForUser(userId, contextToken) {
		const now = Date.now();
		const entry = this.cache.get(userId);
		if (!entry || now >= entry.nextFetchAt) {
			let fetchOk = false;
			try {
				const resp = await getConfig({
					...this.apiOpts,
					baseUrl: this.apiOpts.baseUrl,
					token: this.apiOpts.token,
					ilinkUserId: userId,
					contextToken
				});
				if (resp.ret === 0) {
					this.cache.set(userId, {
						config: { typingTicket: resp.typing_ticket ?? "" },
						everSucceeded: true,
						nextFetchAt: now + Math.random() * CONFIG_CACHE_TTL_MS,
						retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS
					});
					this.log(`[weixin] config ${entry?.everSucceeded ? "refreshed" : "cached"} for ${userId}`);
					fetchOk = true;
				}
			} catch (err) {
				this.log(`[weixin] getConfig failed for ${userId} (ignored): ${String(err)}`);
			}
			if (!fetchOk) {
				const prevDelay = entry?.retryDelayMs ?? CONFIG_CACHE_INITIAL_RETRY_MS;
				const nextDelay = Math.min(prevDelay * 2, CONFIG_CACHE_MAX_RETRY_MS);
				if (entry) {
					entry.nextFetchAt = now + nextDelay;
					entry.retryDelayMs = nextDelay;
				} else this.cache.set(userId, {
					config: { typingTicket: "" },
					everSucceeded: false,
					nextFetchAt: now + CONFIG_CACHE_INITIAL_RETRY_MS,
					retryDelayMs: CONFIG_CACHE_INITIAL_RETRY_MS
				});
			}
		}
		return this.cache.get(userId)?.config ?? { typingTicket: "" };
	}
};
//#endregion
//#region src/api/session-guard.ts
const SESSION_PAUSE_DURATION_MS = 3600 * 1e3;
const pauseUntilMap = /* @__PURE__ */ new Map();
/** Pause all inbound/outbound API calls for `accountId` for one hour. */
function pauseSession(accountId) {
	const until = Date.now() + SESSION_PAUSE_DURATION_MS;
	pauseUntilMap.set(accountId, until);
	logger.info(`session-guard: paused accountId=${accountId} until=${new Date(until).toISOString()} (${SESSION_PAUSE_DURATION_MS / 1e3}s)`);
}
/** Milliseconds remaining until the pause expires (0 when not paused). */
function getRemainingPauseMs(accountId) {
	const until = pauseUntilMap.get(accountId);
	if (until === void 0) return 0;
	const remaining = until - Date.now();
	if (remaining <= 0) {
		pauseUntilMap.delete(accountId);
		return 0;
	}
	return remaining;
}
//#endregion
//#region src/cdn/pic-decrypt.ts
/**
* Download raw bytes from the CDN (no decryption).
*/
async function fetchCdnBytes(url, label) {
	let res;
	try {
		res = await fetch(url);
	} catch (err) {
		const cause = err.cause ?? err.code ?? "(no cause)";
		logger.error(`${label}: fetch network error url=${url} err=${String(err)} cause=${String(cause)}`);
		throw err;
	}
	logger.debug(`${label}: response status=${res.status} ok=${res.ok}`);
	if (!res.ok) {
		const body = await res.text().catch(() => "(unreadable)");
		const msg = `${label}: CDN download ${res.status} ${res.statusText} body=${body}`;
		logger.error(msg);
		throw new Error(msg);
	}
	return Buffer.from(await res.arrayBuffer());
}
/**
* Parse CDNMedia.aes_key into a raw 16-byte AES key.
*
* Two encodings are seen in the wild:
*   - base64(raw 16 bytes)          → images (aes_key from media field)
*   - base64(hex string of 16 bytes) → file / voice / video
*
* In the second case, base64-decoding yields 32 ASCII hex chars which must
* then be parsed as hex to recover the actual 16-byte key.
*/
function parseAesKey(aesKeyBase64, label) {
	const decoded = Buffer.from(aesKeyBase64, "base64");
	if (decoded.length === 16) return decoded;
	if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) return Buffer.from(decoded.toString("ascii"), "hex");
	const msg = `${label}: aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes (base64="${aesKeyBase64}")`;
	logger.error(msg);
	throw new Error(msg);
}
/**
* Download and AES-128-ECB decrypt a CDN media file. Returns plaintext Buffer.
* aesKeyBase64: CDNMedia.aes_key JSON field (see parseAesKey for supported formats).
*/
async function downloadAndDecryptBuffer(encryptedQueryParam, aesKeyBase64, cdnBaseUrl, label, fullUrl) {
	const key = parseAesKey(aesKeyBase64, label);
	const url = fullUrl || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
	logger.debug(`${label}: fetching url=${url}`);
	const encrypted = await fetchCdnBytes(url, label);
	logger.debug(`${label}: downloaded ${encrypted.byteLength} bytes, decrypting`);
	const decrypted = decryptAesEcb(encrypted, key);
	logger.debug(`${label}: decrypted ${decrypted.length} bytes`);
	return decrypted;
}
/**
* Download plain (unencrypted) bytes from the CDN. Returns the raw Buffer.
*/
async function downloadPlainCdnBuffer(encryptedQueryParam, cdnBaseUrl, label, fullUrl) {
	const url = fullUrl || buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
	logger.debug(`${label}: fetching url=${url}`);
	return fetchCdnBytes(url, label);
}
//#endregion
//#region src/media/silk-transcode.ts
/** Default sample rate for Weixin voice messages. */
const SILK_SAMPLE_RATE = 24e3;
/**
* Wrap raw pcm_s16le bytes in a WAV container.
* Mono channel, 16-bit signed little-endian.
*/
function pcmBytesToWav(pcm, sampleRate) {
	const pcmBytes = pcm.byteLength;
	const totalSize = 44 + pcmBytes;
	const buf = Buffer.allocUnsafe(totalSize);
	let offset = 0;
	buf.write("RIFF", offset);
	offset += 4;
	buf.writeUInt32LE(totalSize - 8, offset);
	offset += 4;
	buf.write("WAVE", offset);
	offset += 4;
	buf.write("fmt ", offset);
	offset += 4;
	buf.writeUInt32LE(16, offset);
	offset += 4;
	buf.writeUInt16LE(1, offset);
	offset += 2;
	buf.writeUInt16LE(1, offset);
	offset += 2;
	buf.writeUInt32LE(sampleRate, offset);
	offset += 4;
	buf.writeUInt32LE(sampleRate * 2, offset);
	offset += 4;
	buf.writeUInt16LE(2, offset);
	offset += 2;
	buf.writeUInt16LE(16, offset);
	offset += 2;
	buf.write("data", offset);
	offset += 4;
	buf.writeUInt32LE(pcmBytes, offset);
	offset += 4;
	Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);
	return buf;
}
/**
* Try to transcode a SILK audio buffer to WAV using silk-wasm.
* silk-wasm's decode() returns { data: Uint8Array (pcm_s16le), duration: number }.
*
* Returns a WAV Buffer on success, or null if silk-wasm is unavailable or decoding fails.
* Callers should fall back to passing the raw SILK file when null is returned.
*/
async function silkToWav(silkBuf) {
	try {
		const { decode } = await import("silk-wasm");
		logger.debug(`silkToWav: decoding ${silkBuf.length} bytes of SILK`);
		const result = await decode(silkBuf, SILK_SAMPLE_RATE);
		logger.debug(`silkToWav: decoded duration=${result.duration}ms pcmBytes=${result.data.byteLength}`);
		const wav = pcmBytesToWav(result.data, SILK_SAMPLE_RATE);
		logger.debug(`silkToWav: WAV size=${wav.length}`);
		return wav;
	} catch (err) {
		logger.warn(`silkToWav: transcode failed, will use raw silk err=${String(err)}`);
		return null;
	}
}
//#endregion
//#region src/media/media-download.ts
const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
/**
* Download and decrypt media from a single MessageItem.
* Returns the populated WeixinInboundMediaOpts fields; empty object on unsupported type or failure.
*/
async function downloadMediaFromItem(item, deps) {
	const { cdnBaseUrl, saveMedia, log, errLog, label } = deps;
	const result = {};
	if (item.type === MessageItemType.IMAGE) {
		const img = item.image_item;
		if (!img?.media?.encrypt_query_param && !img?.media?.full_url) return result;
		const aesKeyBase64 = img.aeskey ? Buffer.from(img.aeskey, "hex").toString("base64") : img.media.aes_key;
		logger.debug(`${label} image: encrypt_query_param=${(img.media.encrypt_query_param ?? "").slice(0, 40)}... hasAesKey=${Boolean(aesKeyBase64)} aeskeySource=${img.aeskey ? "image_item.aeskey" : "media.aes_key"} full_url=${Boolean(img.media.full_url)}`);
		try {
			const saved = await saveMedia(aesKeyBase64 ? await downloadAndDecryptBuffer(img.media.encrypt_query_param ?? "", aesKeyBase64, cdnBaseUrl, `${label} image`, img.media.full_url) : await downloadPlainCdnBuffer(img.media.encrypt_query_param ?? "", cdnBaseUrl, `${label} image-plain`, img.media.full_url), void 0, "inbound", WEIXIN_MEDIA_MAX_BYTES);
			result.decryptedPicPath = saved.path;
			logger.debug(`${label} image saved: ${saved.path}`);
		} catch (err) {
			logger.error(`${label} image download/decrypt failed: ${String(err)}`);
			errLog(`weixin ${label} image download/decrypt failed: ${String(err)}`);
		}
	} else if (item.type === MessageItemType.VOICE) {
		const voice = item.voice_item;
		if (!voice?.media?.encrypt_query_param && !voice?.media?.full_url || !voice?.media?.aes_key) return result;
		try {
			const silkBuf = await downloadAndDecryptBuffer(voice.media.encrypt_query_param ?? "", voice.media.aes_key, cdnBaseUrl, `${label} voice`, voice.media.full_url);
			logger.debug(`${label} voice: decrypted ${silkBuf.length} bytes, attempting silk transcode`);
			const wavBuf = await silkToWav(silkBuf);
			if (wavBuf) {
				const saved = await saveMedia(wavBuf, "audio/wav", "inbound", WEIXIN_MEDIA_MAX_BYTES);
				result.decryptedVoicePath = saved.path;
				result.voiceMediaType = "audio/wav";
				logger.debug(`${label} voice: saved WAV to ${saved.path}`);
			} else {
				const saved = await saveMedia(silkBuf, "audio/silk", "inbound", WEIXIN_MEDIA_MAX_BYTES);
				result.decryptedVoicePath = saved.path;
				result.voiceMediaType = "audio/silk";
				logger.debug(`${label} voice: silk transcode unavailable, saved raw SILK to ${saved.path}`);
			}
		} catch (err) {
			logger.error(`${label} voice download/transcode failed: ${String(err)}`);
			errLog(`weixin ${label} voice download/transcode failed: ${String(err)}`);
		}
	} else if (item.type === MessageItemType.FILE) {
		const fileItem = item.file_item;
		if (!fileItem?.media?.encrypt_query_param && !fileItem?.media?.full_url || !fileItem?.media?.aes_key) return result;
		try {
			const buf = await downloadAndDecryptBuffer(fileItem.media.encrypt_query_param ?? "", fileItem.media.aes_key, cdnBaseUrl, `${label} file`, fileItem.media.full_url);
			const mime = getMimeFromFilename(fileItem.file_name ?? "file.bin");
			const saved = await saveMedia(buf, mime, "inbound", WEIXIN_MEDIA_MAX_BYTES, fileItem.file_name ?? void 0);
			result.decryptedFilePath = saved.path;
			result.fileMediaType = mime;
			logger.debug(`${label} file: saved to ${saved.path} mime=${mime}`);
		} catch (err) {
			logger.error(`${label} file download failed: ${String(err)}`);
			errLog(`weixin ${label} file download failed: ${String(err)}`);
		}
	} else if (item.type === MessageItemType.VIDEO) {
		const videoItem = item.video_item;
		if (!videoItem?.media?.encrypt_query_param && !videoItem?.media?.full_url || !videoItem?.media?.aes_key) return result;
		try {
			const saved = await saveMedia(await downloadAndDecryptBuffer(videoItem.media.encrypt_query_param ?? "", videoItem.media.aes_key, cdnBaseUrl, `${label} video`, videoItem.media.full_url), "video/mp4", "inbound", WEIXIN_MEDIA_MAX_BYTES);
			result.decryptedVideoPath = saved.path;
			logger.debug(`${label} video: saved to ${saved.path}`);
		} catch (err) {
			logger.error(`${label} video download failed: ${String(err)}`);
			errLog(`weixin ${label} video download failed: ${String(err)}`);
		}
	}
	return result;
}
//#endregion
//#region src/messaging/error-notice.ts
/**
* Send a plain-text error notice back to the user.
* Fire-and-forget: errors are logged but never thrown, so callers stay unaffected.
* No-op when contextToken is absent (we have no conversation reference to reply into).
*/
async function sendWeixinErrorNotice(params) {
	if (!params.contextToken) {
		logger.warn(`sendWeixinErrorNotice: no contextToken for to=${params.to}, cannot notify user`);
		return;
	}
	try {
		await sendMessageWeixin({
			to: params.to,
			text: params.message,
			opts: {
				baseUrl: params.baseUrl,
				token: params.token,
				botAgent: params.botAgent,
				contextToken: params.contextToken
			}
		});
		logger.debug(`sendWeixinErrorNotice: sent to=${params.to}`);
	} catch (err) {
		params.errLog(`[weixin] sendWeixinErrorNotice failed to=${params.to}: ${String(err)}`);
	}
}
//#endregion
//#region src/messaging/partial-quote.ts
function nthIndexOf(text, value, occurrence, fromIndex = 0) {
	if (!value || !Number.isInteger(occurrence) || occurrence < 0) return -1;
	let position = fromIndex;
	for (let current = 0; current <= occurrence; current++) {
		position = text.indexOf(value, position);
		if (position < 0) return -1;
		if (current < occurrence) position += value.length;
	}
	return position;
}
function hashQuote(text) {
	return crypto.createHash("md5").update(text, "utf8").digest("hex");
}
function candidate(fullText, partial, endSearchMode) {
	const start = nthIndexOf(fullText, partial.start, partial.startindex);
	if (start < 0) return null;
	const end = endSearchMode === "global" ? nthIndexOf(fullText, partial.end, partial.endindex) : nthIndexOf(fullText, partial.end, partial.endindex, start + partial.start.length);
	if (end < start) return null;
	return fullText.slice(start, end + partial.end.length);
}
/**
* Resolve both observed interpretations of endindex. When quotemd5 is present
* it disambiguates the protocol variants; without a hash, global indexes match
* the examples supplied with the newer Weixin payload definition.
*/
function resolvePartialQuote(fullText, partial) {
	if (!fullText || !partial.start || !partial.end) return {
		resolved: null,
		fallback: true
	};
	const candidates = [candidate(fullText, partial, "global"), candidate(fullText, partial, "relative")].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
	if (!partial.quotemd5) return candidates[0] ? {
		resolved: candidates[0],
		fallback: false
	} : {
		resolved: null,
		fallback: true
	};
	const expected = partial.quotemd5.toLowerCase();
	const resolved = candidates.find((value) => hashQuote(value) === expected) ?? null;
	return {
		resolved,
		fallback: resolved === null
	};
}
//#endregion
//#region src/messaging/quotes.ts
function messageId(message) {
	return message.message_id || message.item_list?.find((item) => item.msg_id)?.msg_id;
}
function messageBody(items) {
	const text = bodyFromItemList(items?.map((item) => ({
		...item,
		ref_msg: void 0
	})));
	if (text) return text;
	const type = items?.find((item) => item.type && item.type > 1)?.type;
	return {
		2: "[图片]",
		3: "[语音]",
		4: "[文件]",
		5: "[视频]"
	}[type ?? 0] ?? "";
}
function resolveQuote(message, accountId, store) {
	const ref = message.item_list?.find((item) => item.ref_msg)?.ref_msg;
	if (!ref) return;
	const id = ref.svr_id || ref.message_item?.msg_id;
	const inline = [ref.title, ref.message_item && messageBody([ref.message_item])].filter(Boolean).join(" | ");
	if (inline) return {
		messageId: id,
		text: inline
	};
	if (!id) return;
	try {
		const record = store?.find(accountId, message.from_user_id ?? "", id);
		if (!record) return {
			messageId: id,
			text: "[引用消息内容未缓存]",
			missing: true
		};
		let media;
		if (record.mediaPath && fs.existsSync(record.mediaPath)) {
			const mimeType = record.mediaMime ?? "application/octet-stream";
			media = {
				type: mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "file",
				filePath: record.mediaPath,
				mimeType,
				fileName: record.mediaName
			};
		}
		const expiredMedia = !media && Boolean(record.mediaMime || record.mediaName);
		const partial = ref.partial_text && resolvePartialQuote(record.body, ref.partial_text);
		return {
			messageId: id,
			text: expiredMedia ? `[引用附件已过期${record.mediaName ? `: ${record.mediaName}` : ""}]` : record.body,
			partialText: partial && !partial.fallback ? partial.resolved ?? void 0 : void 0,
			media
		};
	} catch (err) {
		logger.warn(`Unable to resolve quote: ${String(err)}`);
		return {
			messageId: id,
			text: "[引用消息内容未缓存]",
			missing: true
		};
	}
}
//#endregion
//#region src/messaging/debug-mode.ts
/**
* Per-bot debug mode toggle, persisted to disk so it survives gateway restarts.
*
* State file: `<stateDir>/openclaw-weixin/debug-mode.json`
* Format:     `{ "accounts": { "<accountId>": true, ... } }`
*
* When enabled, processOneMessage appends a timing summary after each
* AI reply is delivered to the user.
*/
function resolveDebugModePath() {
	return path.join(resolveStateDir(), "openclaw-weixin", "debug-mode.json");
}
function loadState() {
	try {
		const raw = fs.readFileSync(resolveDebugModePath(), "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.accounts === "object") return parsed;
	} catch {}
	return { accounts: {} };
}
function saveState(state) {
	const filePath = resolveDebugModePath();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}
/** Toggle debug mode for a bot account. Returns the new state. */
function toggleDebugMode(accountId) {
	const state = loadState();
	const next = !state.accounts[accountId];
	state.accounts[accountId] = next;
	try {
		saveState(state);
	} catch (err) {
		logger.error(`debug-mode: failed to persist state: ${String(err)}`);
	}
	return next;
}
//#endregion
//#region src/messaging/slash-commands.ts
/** 发送回复消息 */
async function sendReply(ctx, text) {
	const opts = {
		baseUrl: ctx.baseUrl,
		token: ctx.token,
		botAgent: ctx.botAgent,
		contextToken: ctx.contextToken
	};
	await sendMessageWeixin({
		to: ctx.to,
		text,
		opts
	});
}
/** 处理 /echo 指令 */
async function handleEcho(ctx, args, receivedAt, eventTimestamp) {
	const message = args.trim();
	if (message) await sendReply(ctx, message);
	const eventTs = eventTimestamp ?? 0;
	const platformDelay = eventTs > 0 ? `${receivedAt - eventTs}ms` : "N/A";
	await sendReply(ctx, [
		"⏱ 通道耗时",
		`├ 事件时间: ${eventTs > 0 ? new Date(eventTs).toISOString() : "N/A"}`,
		`├ 平台→插件: ${platformDelay}`,
		`└ 插件处理: ${Date.now() - receivedAt}ms`
	].join("\n"));
}
/**
* 尝试处理斜杠指令
*
* @returns handled=true 表示该消息已作为指令处理，不需要继续走 AI 管道
*/
async function handleSlashCommand(content, ctx, receivedAt, eventTimestamp) {
	const trimmed = content.trim();
	if (!trimmed.startsWith("/")) return { handled: false };
	const spaceIdx = trimmed.indexOf(" ");
	const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
	const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
	logger.info(`[weixin] Slash command: ${command}, args: ${args.slice(0, 50)}`);
	try {
		switch (command) {
			case "/echo":
				await handleEcho(ctx, args, receivedAt, eventTimestamp);
				return { handled: true };
			case "/toggle-debug":
				await sendReply(ctx, toggleDebugMode(ctx.accountId) ? "Debug 模式已开启" : "Debug 模式已关闭");
				return { handled: true };
			case "/clear":
				ctx.onClear?.();
				await sendReply(ctx, "✅ 会话已清除，重新开始对话");
				return { handled: true };
			default: return { handled: false };
		}
	} catch (err) {
		logger.error(`[weixin] Slash command error: ${String(err)}`);
		try {
			await sendReply(ctx, `❌ 指令执行失败: ${String(err).slice(0, 200)}`);
		} catch {}
		return { handled: true };
	}
}
//#endregion
//#region src/messaging/process-message.ts
const MEDIA_TEMP_DIR = path.join(os.tmpdir(), "weixin-agent/media");
/** Save a buffer to a temporary file, returning the file path. */
async function saveMediaBuffer(buffer, contentType, subdir, _maxBytes, originalFilename) {
	const dir = path.join(MEDIA_TEMP_DIR, subdir ?? "");
	await fs$1.mkdir(dir, { recursive: true });
	let ext = ".bin";
	if (originalFilename) ext = path.extname(originalFilename) || ".bin";
	else if (contentType) ext = getExtensionFromMime(contentType);
	const name = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
	const filePath = path.join(dir, name);
	await fs$1.writeFile(filePath, buffer);
	return { path: filePath };
}
/** Extract raw text from item_list (for slash command detection). */
function extractTextBody(itemList) {
	if (!itemList?.length) return "";
	for (const item of itemList) if (item.type === MessageItemType.TEXT && item.text_item?.text != null) return String(item.text_item.text);
	return "";
}
/** Find the first downloadable media item from a message. */
function findMediaItem(itemList) {
	if (!itemList?.length) return void 0;
	const hasDownloadableMedia = (m) => m?.encrypt_query_param || m?.full_url;
	const direct = itemList.find((i) => i.type === MessageItemType.IMAGE && hasDownloadableMedia(i.image_item?.media)) ?? itemList.find((i) => i.type === MessageItemType.VIDEO && hasDownloadableMedia(i.video_item?.media)) ?? itemList.find((i) => i.type === MessageItemType.FILE && hasDownloadableMedia(i.file_item?.media)) ?? itemList.find((i) => i.type === MessageItemType.VOICE && hasDownloadableMedia(i.voice_item?.media) && !i.voice_item?.text);
	if (direct) return direct;
	return itemList.find((i) => i.type === MessageItemType.TEXT && i.ref_msg?.message_item && isMediaItem(i.ref_msg.message_item))?.ref_msg?.message_item ?? void 0;
}
/**
* Process a single inbound message:
*   slash command check → download media → call agent → send reply.
*/
async function processOneMessage(full, deps) {
	const receivedAt = Date.now();
	const textBody = extractTextBody(full.item_list);
	const contextToken = full.context_token;
	if (contextToken) setContextToken(deps.accountId, full.from_user_id ?? "", contextToken);
	if (textBody.startsWith("/")) {
		const conversationId = full.from_user_id ?? "";
		if ((await handleSlashCommand(textBody, {
			to: conversationId,
			contextToken: full.context_token,
			baseUrl: deps.baseUrl,
			token: deps.token,
			botAgent: deps.botAgent,
			accountId: deps.accountId,
			log: deps.log,
			errLog: deps.errLog,
			onClear: () => deps.agent.clearSession?.(conversationId)
		}, receivedAt, full.create_time_ms)).handled) return;
	}
	let media;
	const mediaItem = findMediaItem(full.item_list);
	if (mediaItem) try {
		const downloaded = await downloadMediaFromItem(mediaItem, {
			cdnBaseUrl: deps.cdnBaseUrl,
			saveMedia: saveMediaBuffer,
			log: deps.log,
			errLog: deps.errLog,
			label: "inbound"
		});
		if (downloaded.decryptedPicPath) media = {
			type: "image",
			filePath: downloaded.decryptedPicPath,
			mimeType: "image/*"
		};
		else if (downloaded.decryptedVideoPath) media = {
			type: "video",
			filePath: downloaded.decryptedVideoPath,
			mimeType: "video/mp4"
		};
		else if (downloaded.decryptedFilePath) media = {
			type: "file",
			filePath: downloaded.decryptedFilePath,
			fileName: mediaItem.file_item?.file_name,
			mimeType: downloaded.fileMediaType ?? "application/octet-stream"
		};
		else if (downloaded.decryptedVoicePath) media = {
			type: "audio",
			filePath: downloaded.decryptedVoicePath,
			mimeType: downloaded.voiceMediaType ?? "audio/wav"
		};
	} catch (err) {
		logger.error(`media download failed: ${String(err)}`);
	}
	const id = messageId(full);
	const ownMedia = full.item_list?.includes(mediaItem) ? media : void 0;
	if (id && deps.quoteStore) try {
		await deps.quoteStore.put({
			accountId: deps.accountId,
			conversationId: full.from_user_id ?? "",
			messageId: id,
			direction: "inbound",
			body: messageBody(full.item_list),
			createdAt: full.create_time_ms ?? receivedAt,
			sourceMediaPath: ownMedia?.filePath,
			mediaMime: ownMedia?.mimeType,
			mediaName: ownMedia?.fileName
		});
	} catch (err) {
		logger.warn(`Unable to cache inbound message: ${String(err)}`);
	}
	const quote = resolveQuote(full, deps.accountId, deps.quoteStore);
	const body = messageBody(full.item_list);
	const request = {
		conversationId: full.from_user_id ?? "",
		messageId: id,
		text: quote ? `[引用: ${quote.partialText ?? quote.text}]\n${body}` : body,
		media: media ?? quote?.media,
		quote
	};
	const to = full.from_user_id ?? "";
	let typingTimer;
	const startTyping = () => {
		if (!deps.typingTicket) return;
		sendTyping({
			baseUrl: deps.baseUrl,
			token: deps.token,
			botAgent: deps.botAgent,
			body: {
				ilink_user_id: to,
				typing_ticket: deps.typingTicket,
				status: TypingStatus.TYPING
			}
		}).catch(() => {});
	};
	if (deps.typingTicket) {
		startTyping();
		typingTimer = setInterval(startTyping, 1e4);
	}
	try {
		const response = await deps.agent.chat(request);
		if (response.text || response.media) await sendChatResponse(response, {
			to,
			accountId: deps.accountId,
			cdnBaseUrl: deps.cdnBaseUrl,
			outputFormat: deps.outputFormat,
			hooks: deps.hooks,
			opts: {
				baseUrl: deps.baseUrl,
				token: deps.token,
				contextToken,
				botAgent: deps.botAgent,
				accountId: deps.accountId,
				quoteStore: deps.quoteStore
			}
		});
	} catch (err) {
		logger.error(`processOneMessage: agent or send failed: ${err instanceof Error ? err.stack ?? err.message : JSON.stringify(err)}`);
		sendWeixinErrorNotice({
			to,
			contextToken,
			message: `⚠️ 处理消息失败：${err instanceof Error ? err.message : JSON.stringify(err)}`,
			baseUrl: deps.baseUrl,
			token: deps.token,
			botAgent: deps.botAgent,
			errLog: deps.errLog
		});
	} finally {
		if (typingTimer) clearInterval(typingTimer);
		if (deps.typingTicket) sendTyping({
			baseUrl: deps.baseUrl,
			token: deps.token,
			botAgent: deps.botAgent,
			body: {
				ilink_user_id: to,
				typing_ticket: deps.typingTicket,
				status: TypingStatus.CANCEL
			}
		}).catch(() => {});
	}
}
//#endregion
//#region src/storage/sync-buf.ts
function resolveAccountsDir() {
	return path.join(resolveStateDir(), "openclaw-weixin", "accounts");
}
/**
* Path to the persistent get_updates_buf file for an account.
* Stored alongside account data: ~/.openclaw/openclaw-weixin/accounts/{accountId}.sync.json
*/
function getSyncBufFilePath(accountId) {
	return path.join(resolveAccountsDir(), `${accountId}.sync.json`);
}
/** Legacy single-account syncbuf (pre multi-account): `.openclaw-weixin-sync/default.json`. */
function getLegacySyncBufDefaultJsonPath() {
	return path.join(resolveStateDir(), "agents", "default", "sessions", ".openclaw-weixin-sync", "default.json");
}
function readSyncBufFile(filePath) {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		if (typeof data.get_updates_buf === "string") return data.get_updates_buf;
	} catch {}
}
/**
* Load persisted get_updates_buf.
* Falls back in order:
*   1. Primary path (normalized accountId, new installs)
*   2. Compat path (raw accountId derived from pattern, old installs)
*   3. Legacy single-account path (very old installs without multi-account support)
*/
function loadGetUpdatesBuf(filePath) {
	const value = readSyncBufFile(filePath);
	if (value !== void 0) return value;
	const rawId = deriveRawAccountId(path.basename(filePath, ".sync.json"));
	if (rawId) {
		const compatValue = readSyncBufFile(path.join(resolveAccountsDir(), `${rawId}.sync.json`));
		if (compatValue !== void 0) return compatValue;
	}
	return readSyncBufFile(getLegacySyncBufDefaultJsonPath());
}
/**
* Persist get_updates_buf. Creates parent dir if needed.
*/
function saveGetUpdatesBuf(filePath, getUpdatesBuf) {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0), "utf-8");
}
//#endregion
//#region src/monitor/monitor.ts
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35e3;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 3e4;
const RETRY_DELAY_MS = 2e3;
/**
* Long-poll loop: getUpdates → process message → call agent → send reply.
* Runs until aborted.
*/
async function monitorWeixinProvider(opts) {
	const { baseUrl, cdnBaseUrl, token, accountId, agent, abortSignal, longPollTimeoutMs } = opts;
	const log = opts.log ?? ((msg) => console.log(msg));
	const errLog = (msg) => {
		log(msg);
		logger.error(msg);
	};
	const aLog = logger.withAccount(accountId);
	log(`[weixin] monitor started (${baseUrl}, account=${accountId})`);
	aLog.info(`Monitor started: baseUrl=${baseUrl}`);
	const syncFilePath = getSyncBufFilePath(accountId);
	const previousGetUpdatesBuf = loadGetUpdatesBuf(syncFilePath);
	let getUpdatesBuf = previousGetUpdatesBuf ?? "";
	if (previousGetUpdatesBuf) log(`[weixin] resuming from previous sync buf (${getUpdatesBuf.length} bytes)`);
	else log(`[weixin] no previous sync buf, starting fresh`);
	const configManager = new WeixinConfigManager({
		baseUrl,
		token,
		botAgent: opts.botAgent
	}, log);
	let nextTimeoutMs = longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
	let consecutiveFailures = 0;
	while (!abortSignal?.aborted) try {
		const resp = await getUpdates({
			baseUrl,
			token,
			get_updates_buf: getUpdatesBuf,
			botAgent: opts.botAgent,
			timeoutMs: nextTimeoutMs,
			abortSignal
		});
		if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) nextTimeoutMs = resp.longpolling_timeout_ms;
		if (resp.ret !== void 0 && resp.ret !== 0 || resp.errcode !== void 0 && resp.errcode !== 0) {
			if (resp.errcode === -14 || resp.ret === -14) {
				pauseSession(accountId);
				const pauseMs = getRemainingPauseMs(accountId);
				errLog(`[weixin] token stale (errcode -14), pausing for ${Math.ceil(pauseMs / 6e4)} min. Please run \`npx weixin-acp login\` to re-login.`);
				consecutiveFailures = 0;
				await sleep(pauseMs, abortSignal);
				continue;
			}
			consecutiveFailures += 1;
			errLog(`[weixin] getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
			if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				errLog(`[weixin] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`);
				consecutiveFailures = 0;
				await sleep(BACKOFF_DELAY_MS, abortSignal);
			} else await sleep(RETRY_DELAY_MS, abortSignal);
			continue;
		}
		consecutiveFailures = 0;
		if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
			saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
			getUpdatesBuf = resp.get_updates_buf;
		}
		const list = resp.msgs ?? [];
		for (const full of list) {
			if (abortSignal?.aborted) return;
			aLog.info(`inbound: from=${full.from_user_id} types=${full.item_list?.map((i) => i.type).join(",") ?? "none"}`);
			const fromUserId = full.from_user_id ?? "";
			const cachedConfig = await configManager.getForUser(fromUserId, full.context_token);
			await processOneMessage(full, {
				outputFormat: opts.outputFormat,
				botAgent: opts.botAgent,
				hooks: opts.hooks,
				quoteStore: opts.quoteStore,
				accountId,
				agent,
				baseUrl,
				cdnBaseUrl,
				token,
				typingTicket: cachedConfig.typingTicket,
				log,
				errLog
			});
		}
	} catch (err) {
		if (abortSignal?.aborted) {
			aLog.info(`Monitor stopped (aborted)`);
			return;
		}
		consecutiveFailures += 1;
		errLog(`[weixin] getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${String(err)} (${classifyFetchError(err).type})`);
		if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
			consecutiveFailures = 0;
			await sleep(BACKOFF_DELAY_MS, abortSignal);
		} else await sleep(RETRY_DELAY_MS, abortSignal);
	}
	aLog.info(`Monitor ended`);
}
async function sleep(ms, signal) {
	try {
		const { setTimeout } = await import("node:timers/promises");
		await setTimeout(ms, void 0, { signal });
	} catch (err) {
		if (!signal?.aborted) throw err;
	}
}
//#endregion
//#region src/bot.ts
/**
* Interactive QR-code login. Prints the QR code to the terminal and waits
* for the user to scan it with WeChat.
*
* Returns the normalized account ID on success.
*/
async function login(opts) {
	const log = opts?.log ?? console.log;
	const apiBaseUrl = opts?.baseUrl ?? "https://ilinkai.weixin.qq.com";
	const signal = AbortSignal.any([AbortSignal.timeout(opts?.timeoutMs ?? 48e4), ...opts?.abortSignal ? [opts.abortSignal] : []]);
	const onVerifyCode = opts?.onVerifyCode ?? (async ({ retry, signal }) => {
		if (!process.stdin.isTTY) throw new Error("非交互登录需要提供 onVerifyCode 回调");
		const terminal = createInterface({
			input: process.stdin,
			output: process.stdout
		});
		try {
			return await terminal.question(retry ? "验证码不匹配，请重新输入：" : "请输入手机微信显示的数字：", { signal });
		} finally {
			terminal.close();
		}
	});
	log("正在启动微信扫码登录...");
	const startResult = await startWeixinLoginWithQr({
		apiBaseUrl,
		botType: "3",
		abortSignal: signal
	});
	if (!startResult.qrcodeUrl) throw new Error(startResult.message);
	log("\n使用微信扫描以下二维码，以完成连接：\n");
	try {
		const qrcodeterminal = await import("qrcode-terminal");
		await new Promise((resolve) => {
			qrcodeterminal.default.generate(startResult.qrcodeUrl, { small: true }, (qr) => {
				console.log(qr);
				resolve();
			});
		});
	} catch {
		log(`二维码链接: ${startResult.qrcodeUrl}`);
	}
	log("\n等待扫码...\n");
	const waitResult = await waitForWeixinLogin({
		sessionKey: startResult.sessionKey,
		apiBaseUrl,
		timeoutMs: opts?.timeoutMs ?? 48e4,
		onVerifyCode,
		botType: "3",
		abortSignal: signal
	});
	if (waitResult.alreadyConnected) {
		const ids = listWeixinAccountIds();
		const id = waitResult.accountId ? normalizeAccountId(waitResult.accountId) : ids.length === 1 ? ids[0] : void 0;
		if (!id || !loadWeixinAccount(id)?.token) throw new Error("微信提示已绑定，但无法确定对应的本地账号，请重新登录");
		log(waitResult.message);
		return id;
	}
	if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) throw new Error(waitResult.message);
	const normalizedId = normalizeAccountId(waitResult.accountId);
	saveWeixinAccount(normalizedId, {
		token: waitResult.botToken,
		baseUrl: waitResult.baseUrl,
		userId: waitResult.userId
	});
	registerWeixinAccountId(normalizedId);
	log("\n✅ 与微信连接成功！");
	return normalizedId;
}
/**
* Remove all stored WeChat account credentials.
*/
function logout(opts) {
	const log = opts?.log ?? console.log;
	const ids = listWeixinAccountIds();
	if (ids.length === 0) {
		log("当前没有已登录的账号");
		return;
	}
	for (const id of ids) {
		clearContextTokensForAccount(id);
		deleteQuoteCacheForAccount(id);
	}
	clearAllWeixinAccounts();
	log("✅ 已退出登录");
}
/**
* Check whether at least one WeChat account is logged in and configured.
*/
function isLoggedIn() {
	const ids = listWeixinAccountIds();
	if (ids.length === 0) return false;
	return resolveWeixinAccount(ids[0]).configured;
}
/**
* A running bot instance — provides proactive messaging capability.
*
* - `sendMessage(text)` — send a text message to the logged-in user.
* - `sendMessage(response)` — send a ChatResponse (text and/or media).
*/
var Bot = class {
	_accountId;
	_baseUrl;
	_cdnBaseUrl;
	_token;
	_userId;
	_monitorPromise;
	_options;
	_quoteStore;
	/** @internal */
	constructor(params) {
		this._options = params.options ?? {};
		this._quoteStore = params.quoteStore ?? Promise.resolve(null);
		this._accountId = params.accountId;
		this._baseUrl = params.baseUrl;
		this._cdnBaseUrl = params.cdnBaseUrl;
		this._token = params.token;
		this._userId = params.userId;
		this._monitorPromise = params.monitorPromise;
		this._monitorPromise.catch(() => {});
	}
	/**
	* Wait until the background WeChat monitor stops.
	*
	* This is useful for CLI programs that should keep running until the bot is
	* aborted, and for surfacing unrecoverable monitor errors to the caller.
	*/
	async wait() {
		await this._monitorPromise;
	}
	/**
	* Proactively send a message to the logged-in WeChat user.
	*
	* Accepts either a plain string (sent as text) or a full `ChatResponse`
	* object (text and/or media).
	*
	* Requires a context token from an inbound message. Tokens are restored
	* across restarts; expiration is determined by the WeChat server.
	*/
	async sendMessage(message) {
		const response = typeof message === "string" ? { text: message } : message;
		const contextToken = getContextToken(this._accountId, this._userId);
		if (!contextToken) throw new Error("没有找到 context_token，需要至少收到过一条消息（重启后会恢复缓存）");
		await sendChatResponse(response, {
			to: this._userId,
			accountId: this._accountId,
			cdnBaseUrl: this._cdnBaseUrl,
			outputFormat: this._options.outputFormat,
			hooks: this._options.hooks,
			opts: {
				baseUrl: this._baseUrl,
				token: this._token,
				contextToken,
				botAgent: this._options.botAgent,
				accountId: this._accountId,
				quoteStore: await this._quoteStore
			}
		});
	}
};
/**
* Start the bot — long-polls for new messages and dispatches them to the agent.
*
* Returns a `Bot` instance immediately. Use `bot.wait()` when a CLI program
* should block until the background monitor stops.
*/
function start(agent, opts) {
	const log = opts?.log ?? console.log;
	let accountId = opts?.accountId;
	if (!accountId) {
		const ids = listWeixinAccountIds();
		if (ids.length === 0) throw new Error("没有已登录的账号，请先运行 login");
		accountId = ids[0];
		if (ids.length > 1) log(`[weixin] 检测到多个账号，使用第一个: ${accountId}`);
	}
	const account = resolveWeixinAccount(accountId);
	if (!account.configured) throw new Error(`账号 ${accountId} 未配置 (缺少 token)，请先运行 login`);
	const userId = loadWeixinAccount(account.accountId)?.userId;
	if (!userId) throw new Error(`账号 ${accountId} 没有关联的用户 ID，请重新运行 login`);
	log(`[weixin] 启动 bot, account=${account.accountId}`);
	restoreContextTokens(account.accountId);
	const quoteStore = QuoteStore.open({
		policy: resolveQuoteCachePolicy(opts?.quoteCache),
		rootDir: quoteCacheRoot(account.accountId)
	});
	const apiOpts = {
		baseUrl: account.baseUrl,
		token: account.token,
		botAgent: opts?.botAgent
	};
	const notify = async (event) => {
		try {
			const response = await (event === "start" ? notifyStart : notifyStop)({
				...apiOpts,
				abortSignal: event === "start" ? opts?.abortSignal : void 0
			});
			if (response.ret) log(`[weixin] notify ${event} failed: ret=${response.ret}`);
		} catch (err) {
			log(`[weixin] notify ${event} failed (ignored): ${String(err)}`);
		}
	};
	const monitorPromise = (async () => {
		const store = await quoteStore;
		let started = false;
		try {
			if (opts?.abortSignal?.aborted) return;
			started = true;
			await notify("start");
			await monitorWeixinProvider({
				baseUrl: account.baseUrl,
				cdnBaseUrl: account.cdnBaseUrl,
				token: account.token,
				accountId: account.accountId,
				agent,
				abortSignal: opts?.abortSignal,
				outputFormat: opts?.outputFormat,
				botAgent: opts?.botAgent,
				hooks: opts?.hooks,
				quoteStore: store,
				log
			});
		} finally {
			try {
				if (started) await notify("stop");
			} finally {
				store?.close();
			}
		}
	})();
	return new Bot({
		accountId: account.accountId,
		baseUrl: account.baseUrl,
		cdnBaseUrl: account.cdnBaseUrl,
		token: account.token,
		userId,
		monitorPromise,
		options: opts,
		quoteStore
	});
}
//#endregion
export { Bot, isLoggedIn, login, logout, start };
