import { OAUTH_ENDPOINTS } from "../config/appConstants.ts";
import { PROVIDERS } from "../config/providers.ts";
import { type ExecutorCredentials, type ExecutorHeaders, type ExecutorLogger } from "./base.ts";
import { DefaultExecutor } from "./default.ts";

/** portal.qwen.ai — static fingerprint matching stable Qwen Code release */
const QWEN_USER_AGENT = "QwenCode/0.12.3 (linux; x64)";
const QWEN_STAINLESS = {
  os: "Linux",
  arch: "x64",
  lang: "js",
  runtime: "node",
  runtimeVersion: "v18.19.1",
  packageVersion: "5.11.0",
  retryCount: "1",
};
const QWEN_DEFAULT_SYSTEM_MESSAGE = {
  role: "system",
  content: [{ type: "text", text: "", cache_control: { type: "ephemeral" } }],
};

type JsonRecord = Record<string, unknown>;

type QwenTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  resource_url?: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function ensureQwenSystemMessage(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const next: JsonRecord = { ...asRecord(body) };
  if (Array.isArray(next.messages)) {
    next.messages = [QWEN_DEFAULT_SYSTEM_MESSAGE, ...next.messages];
  } else {
    next.messages = [QWEN_DEFAULT_SYSTEM_MESSAGE];
  }
  return next;
}

function isQwenThinkingActive(body: JsonRecord | null | undefined): boolean {
  const thinking = body?.thinking;
  if (thinking === true || body?.enable_thinking === true) return true;
  return (
    typeof thinking === "object" &&
    thinking !== null &&
    !Array.isArray(thinking) &&
    (thinking as JsonRecord).type === "enabled"
  );
}

// Qwen rejects tool_choice="required" or object forms when thinking is active; neutralize to "auto".
function sanitizeQwenThinkingToolChoice(body: unknown): unknown {
  const record = asRecord(body);
  if (!body || typeof body !== "object" || !isQwenThinkingActive(record)) return body;
  const tc = record.tool_choice;
  const incompatible = tc === "required" || (typeof tc === "object" && tc !== null);
  if (!incompatible) return body;
  return { ...record, tool_choice: "auto" };
}

function buildQwenUpstreamHeaders(
  credentials: ExecutorCredentials | null | undefined,
  stream: boolean = true,
): ExecutorHeaders {
  const token = credentials?.apiKey || credentials?.accessToken || "";
  const headers: ExecutorHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": QWEN_USER_AGENT,
    "X-DashScope-AuthType": "qwen-oauth",
    "X-DashScope-CacheControl": "enable",
    "X-DashScope-UserAgent": QWEN_USER_AGENT,
    "X-Stainless-Arch": QWEN_STAINLESS.arch,
    "X-Stainless-Lang": QWEN_STAINLESS.lang,
    "X-Stainless-Os": QWEN_STAINLESS.os,
    "X-Stainless-Package-Version": QWEN_STAINLESS.packageVersion,
    "X-Stainless-Retry-Count": QWEN_STAINLESS.retryCount,
    "X-Stainless-Runtime": QWEN_STAINLESS.runtime,
    "X-Stainless-Runtime-Version": QWEN_STAINLESS.runtimeVersion,
    Connection: "keep-alive",
    "Accept-Language": "*",
    "Sec-Fetch-Mode": "cors",
  };
  headers.Accept = stream ? "text/event-stream" : "application/json";
  return headers;
}

export class QwenExecutor extends DefaultExecutor {
  constructor() {
    super("qwen");
  }

  // Qwen tokens are bound to a resource_url returned at OAuth time.
  // Using portal.qwen.ai when the token is issued for another shard returns 401/403.
  buildUrl(
    _model: string,
    _stream: boolean,
    _urlIndex: number = 0,
    credentials: ExecutorCredentials | null = null,
  ): string {
    const resourceUrl = credentials?.providerSpecificData?.resourceUrl;
    const host =
      typeof resourceUrl === "string"
        ? resourceUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : "portal.qwen.ai";
    return `https://${host}/v1/chat/completions`;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    return buildQwenUpstreamHeaders(credentials, stream);
  }

  transformRequest(
    _model: string,
    body: unknown,
    stream?: boolean,
    _credentials?: ExecutorCredentials,
  ): unknown {
    let next: unknown = body && typeof body === "object" ? { ...asRecord(body) } : body;
    const nextRecord = asRecord(next);
    if (
      stream &&
      nextRecord.messages &&
      !nextRecord.stream_options &&
      !nextRecord.thinking &&
      !nextRecord.enable_thinking &&
      nextRecord.stream !== false
    ) {
      next = { ...nextRecord, stream_options: { include_usage: true } };
    }
    next = sanitizeQwenThinkingToolChoice(next);
    return ensureQwenSystemMessage(next);
  }

  // Override to capture resource_url from refresh response (required for buildUrl).
  async refreshCredentials(credentials: ExecutorCredentials, log: ExecutorLogger | null) {
    if (!credentials?.refreshToken) return null;
    try {
      const response = await fetch(OAUTH_ENDPOINTS.qwen.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: PROVIDERS.qwen.clientId,
        }),
      });
      if (!response.ok) return null;
      const tokensUnknown: unknown = await response.json();
      const tokens =
        tokensUnknown && typeof tokensUnknown === "object"
          ? (tokensUnknown as QwenTokenPayload)
          : {};
      log?.info?.("TOKEN", "qwen refreshed");
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        providerSpecificData: {
          ...(credentials.providerSpecificData || {}),
          ...(tokens.resource_url ? { resourceUrl: tokens.resource_url } : {}),
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("TOKEN", `qwen refresh error: ${message}`);
      return null;
    }
  }
}

export default QwenExecutor;
