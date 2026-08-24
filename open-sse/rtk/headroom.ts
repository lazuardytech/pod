// Headroom HTTP client: POST messages to Headroom /v1/compress. Fail-open.
// Compress URL: loopback / Docker DNS `headroom`. Local spawn lives in src/lib/headroom/.

import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai.ts";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../translator/request/openai-responses.ts";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.ts";

export const DEFAULT_HEADROOM_URL = "http://localhost:8787";
export const DEFAULT_HEADROOM_TIMEOUT_MS = 3000;

const ALLOWED_HEADROOM_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "headroom"]);

type JsonRecord = Record<string, unknown>;

type HeadroomMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  [key: string]: unknown;
};

type SizeSnapshot = {
  bodyBytes: number;
  messageBytes: number;
  toolSchemaBytes: number;
  toolHistoryBytes: number;
};

export type HeadroomDiagnostics = {
  reason?: string;
  endpoint?: string;
  before?: SizeSnapshot;
  after?: SizeSnapshot;
};

export type HeadroomCompressStats = {
  messages: HeadroomMessage[];
  tokens_before?: number;
  tokens_after?: number;
  tokens_saved?: number;
  [key: string]: unknown;
};

export type HeadroomCompressOptions = {
  enabled?: boolean;
  url?: string;
  model?: unknown;
  format?: string;
  compressUserMessages?: boolean;
  timeoutMs?: number;
  diagnostics?: HeadroomDiagnostics | null;
};

type KiroTarget = { object: JsonRecord; key: string };

export function defaultHeadroomUrl(): string {
  return process.env.HEADROOM_URL || DEFAULT_HEADROOM_URL;
}

export function isAllowedHeadroomUrl(url: unknown): boolean {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  return ALLOWED_HEADROOM_HOSTS.has(host);
}

function jsonBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function messagePayload(body: JsonRecord) {
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  const kiro = collectKiroHeadroomMessages(body);
  if (kiro) return kiro.messages;
  return null;
}

function captureSizeSnapshot(body: JsonRecord): SizeSnapshot {
  const messages = messagePayload(body) as HeadroomMessage[] | null;
  const toolHistory =
    messages?.filter(
      (message) =>
        message?.role === "tool" ||
        message?.role === "function" ||
        (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) ||
        (Array.isArray(message?.content) &&
          message.content.some(
            (part) =>
              part &&
              typeof part === "object" &&
              ((part as { type?: string }).type === "tool_use" ||
                (part as { type?: string }).type === "tool_result"),
          )),
    ) || [];
  return {
    bodyBytes: jsonBytes(body),
    messageBytes: messages ? jsonBytes(messages) : 0,
    toolSchemaBytes: jsonBytes(body.tools || []),
    toolHistoryBytes: jsonBytes(toolHistory),
  };
}

function setDiagnostic(diagnostics: HeadroomDiagnostics | null | undefined, reason: string) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}

function scrubSensitiveUrlText(text: string) {
  return String(text)
    .replace(/\/\/[^/@\s]+@/g, "//")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
}

function describeFetchError(error: unknown) {
  const err = error as {
    cause?: { code?: string; message?: string };
    code?: string;
    message?: string;
  };
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const message = scrubSensitiveUrlText(cause?.message || err?.message || String(error));
  return code ? `${code}: ${message}` : message;
}

function buildCompressEndpoint(url: string) {
  try {
    const parsed = new URL(url);
    const trimmed = parsed.pathname.replace(/\/$/, "").replace(/\/v1\/compress$/, "");
    parsed.pathname = `${trimmed}/v1/compress`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(url).split("#", 1)[0];
    const [base, query = ""] = raw.split("?", 2);
    const endpoint = `${(base ?? "").replace(/\/$/, "").replace(/\/v1\/compress$/, "")}/v1/compress`;
    return query ? `${endpoint}?${query}` : endpoint;
  }
}

function maskEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(endpoint).replace(/\/\/[^/@\s]+@/, "//");
    const cut = Math.min(
      ...["?", "#"].map((c) => {
        const i = raw.indexOf(c);
        return i === -1 ? raw.length : i;
      }),
    );
    return raw.slice(0, cut);
  }
}

function hasUnsafeResponsesInputForCompression(body: JsonRecord) {
  if (!Array.isArray(body.input)) return false;
  return body.input.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const type = (item as { type?: unknown }).type;
    return typeof type === "string" && type !== "message";
  });
}

function collectKiroHeadroomMessages(body: JsonRecord): {
  messages: HeadroomMessage[];
  targets: KiroTarget[];
} | null {
  const state = body.conversationState;
  if (!state || typeof state !== "object") return null;

  const messages: HeadroomMessage[] = [];
  const targets: KiroTarget[] = [];

  const addTextTarget = (
    role: string,
    text: unknown,
    target: KiroTarget,
    extra: Record<string, unknown> = {},
  ) => {
    if (typeof text !== "string") return;
    messages.push({ role, content: text, ...extra });
    targets.push(target);
  };

  const toToolCalls = (toolUses: unknown) => {
    if (!Array.isArray(toolUses) || toolUses.length === 0) return undefined;
    const calls = toolUses
      .map((toolUse) => {
        const tu = toolUse as { toolUseId?: string; name?: string; input?: unknown };
        return {
          id: tu?.toolUseId,
          type: "function",
          function: {
            name: tu?.name || "",
            arguments: JSON.stringify(tu?.input || {}),
          },
        };
      })
      .filter((call) => call.id || call.function.name);
    return calls.length > 0 ? calls : undefined;
  };

  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const rec = item as JsonRecord;
    const user = rec.userInputMessage as JsonRecord | undefined;
    if (user) {
      addTextTarget("system", user.systemInstruction, { object: user, key: "systemInstruction" });
      addTextTarget("user", user.content, { object: user, key: "content" });

      const ctx = user.userInputMessageContext as JsonRecord | undefined;
      const toolResults = ctx?.toolResults;
      if (Array.isArray(toolResults)) {
        for (const toolResult of toolResults) {
          const tr = toolResult as { content?: unknown; toolUseId?: string };
          const content = tr?.content;
          if (!Array.isArray(content)) continue;
          for (const part of content) {
            const p = part as JsonRecord;
            addTextTarget(
              "tool",
              p?.text,
              { object: p, key: "text" },
              tr?.toolUseId ? { tool_call_id: tr.toolUseId } : {},
            );
          }
        }
      }
      return;
    }

    const assistant = rec.assistantResponseMessage as JsonRecord | undefined;
    if (assistant) {
      const toolCalls = toToolCalls(assistant.toolUses);
      addTextTarget(
        "assistant",
        assistant.content,
        { object: assistant, key: "content" },
        toolCalls ? { tool_calls: toolCalls } : {},
      );
    }
  };

  const typedState = state as { history?: unknown[]; currentMessage?: unknown };
  if (Array.isArray(typedState.history)) {
    for (const item of typedState.history) visit(item);
  }
  if (typedState.currentMessage) visit(typedState.currentMessage);

  return messages.length > 0 ? { messages, targets } : null;
}

function textFromHeadroomMessage(message: HeadroomMessage | undefined) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
    } else if (
      part &&
      typeof part === "object" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function applyKiroHeadroomMessages(
  projection: { messages: HeadroomMessage[]; targets: KiroTarget[] },
  compressedMessages: HeadroomMessage[],
  diagnostics: HeadroomDiagnostics | null | undefined,
) {
  if (
    !Array.isArray(compressedMessages) ||
    compressedMessages.length !== projection.messages.length
  ) {
    setDiagnostic(diagnostics, "proxy response did not match Kiro message count");
    return false;
  }

  const updates: Array<{ target: KiroTarget; text: string }> = [];
  for (let i = 0; i < projection.messages.length; i++) {
    const expected = projection.messages[i];
    const actual = compressedMessages[i];
    if (!actual || actual.role !== expected?.role) {
      setDiagnostic(diagnostics, "proxy response did not preserve Kiro message order");
      return false;
    }

    const text = textFromHeadroomMessage(actual);
    if (text === null) {
      setDiagnostic(diagnostics, "proxy response missing Kiro text content");
      return false;
    }
    const target = projection.targets[i];
    if (!target) {
      setDiagnostic(diagnostics, "proxy response did not match Kiro message count");
      return false;
    }
    updates.push({ target, text });
  }

  for (const update of updates) {
    update.target.object[update.target.key] = update.text;
  }
  return true;
}

async function callCompress(
  url: string,
  messages: unknown,
  model: unknown,
  timeoutMs: number,
  compressUserMessages: boolean | undefined,
  diagnostics: HeadroomDiagnostics,
): Promise<HeadroomCompressStats | null> {
  const endpoint = buildCompressEndpoint(url);
  diagnostics.endpoint = maskEndpoint(endpoint);
  const payload: JsonRecord = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    return null;
  }
  if (!res.ok) {
    setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`);
    return null;
  }
  const data = (await res.json()) as HeadroomCompressStats;
  if (!Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, "proxy response missing messages[]");
    return null;
  }
  return data;
}

export async function compressWithHeadroom(
  body: JsonRecord | null | undefined,
  {
    enabled,
    url,
    model,
    format,
    compressUserMessages,
    timeoutMs = DEFAULT_HEADROOM_TIMEOUT_MS,
    diagnostics = null,
  }: HeadroomCompressOptions = {},
): Promise<HeadroomCompressStats | null> {
  if (!enabled) {
    setDiagnostic(diagnostics, "disabled");
    return null;
  }
  if (!url) {
    setDiagnostic(diagnostics, "missing proxy URL");
    return null;
  }
  if (!isAllowedHeadroomUrl(url)) {
    setDiagnostic(diagnostics, "blocked: host not allowed");
    return null;
  }
  if (!body) {
    setDiagnostic(diagnostics, "missing request body");
    return null;
  }

  try {
    if (diagnostics) diagnostics.before = captureSizeSnapshot(body);

    if (format === "claude") {
      const oai = claudeToOpenAIRequest(model, body, false) as JsonRecord;
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "Claude request did not translate to messages[]");
        return null;
      }
      const data = await callCompress(
        url,
        oai.messages,
        model,
        timeoutMs,
        compressUserMessages,
        diagnostics || {},
      );
      if (!data) return null;
      const claudeBody = openaiToClaudeRequest(
        model,
        { ...oai, messages: data.messages },
        false,
      ) as JsonRecord;
      if (Array.isArray(claudeBody?.messages)) body.messages = claudeBody.messages;
      if (claudeBody?.system !== undefined) body.system = claudeBody.system;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    if (format === "openai-responses") {
      if (hasUnsafeResponsesInputForCompression(body)) {
        setDiagnostic(
          diagnostics,
          "skipped: openai-responses tool/reasoning input is not safe to compress",
        );
        return null;
      }
      const oai = openaiResponsesToOpenAIRequest(model, body, false, undefined) as JsonRecord;
      if (!Array.isArray(oai?.messages)) return null;
      const data = await callCompress(
        url,
        oai.messages,
        model,
        timeoutMs,
        compressUserMessages,
        diagnostics || {},
      );
      if (!data) return null;
      const responsesBody = openaiToOpenAIResponsesRequest(
        model,
        { ...oai, input: undefined, messages: data.messages },
        false,
        undefined,
      ) as JsonRecord;
      if (Array.isArray(responsesBody?.input)) body.input = responsesBody.input;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    if (format === "kiro") {
      const projection = collectKiroHeadroomMessages(body);
      if (!projection) {
        setDiagnostic(diagnostics, "Kiro request did not project to messages[]");
        return null;
      }
      const data = await callCompress(
        url,
        projection.messages,
        model,
        timeoutMs,
        compressUserMessages,
        diagnostics || {},
      );
      if (!data) return null;
      if (!applyKiroHeadroomMessages(projection, data.messages, diagnostics)) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    const key = Array.isArray(body.messages)
      ? "messages"
      : Array.isArray(body.input)
        ? "input"
        : null;
    if (!key) {
      setDiagnostic(diagnostics, `unsupported ${format || "unknown"} request shape`);
      return null;
    }
    const data = await callCompress(
      url,
      body[key],
      model,
      timeoutMs,
      compressUserMessages,
      diagnostics || {},
    );
    if (!data) return null;
    body[key] = data.messages;
    if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
    return data;
  } catch (error) {
    setDiagnostic(
      diagnostics,
      `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function probeHeadroom(
  url: string,
  timeoutMs = 2000,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isAllowedHeadroomUrl(url)) return { ok: false, reason: "blocked: host not allowed" };
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    const res = await fetch(parsed.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, reason: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, reason: describeFetchError(error) };
  }
}

export function formatHeadroomLog(stats: HeadroomCompressStats | null | undefined) {
  if (!stats) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const delta = stats.tokens_saved || 0;
  const pct = before > 0 ? ((delta / before) * 100).toFixed(1) : "0";
  return `reported token delta=${delta} before=${before}${after ? ` after=${after}` : ""} (${pct}%)`.trim();
}

export function formatHeadroomSizeLog(diagnostics: HeadroomDiagnostics | null | undefined) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after) return "";
  const effective =
    before.bodyBytes > 0
      ? (((before.bodyBytes - after.bodyBytes) / before.bodyBytes) * 100).toFixed(1)
      : "0.0";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B tools=${before.toolSchemaBytes || 0}B→${after.toolSchemaBytes || 0}B toolHistory=${before.toolHistoryBytes || 0}B→${after.toolHistoryBytes || 0}B effective=${effective}%`;
}

export function isHeadroomPhantomSavings(
  stats: HeadroomCompressStats | null | undefined,
  diagnostics: HeadroomDiagnostics | null | undefined,
  minShrinkRatio = 0.05,
) {
  if (!stats?.tokens_saved || stats.tokens_saved <= 0) return false;
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}
