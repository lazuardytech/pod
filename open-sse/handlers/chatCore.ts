import { appendRequestLog, saveRequestDetail, trackPendingRequest } from "@/lib/usageDb";
import {
  getModelStrip,
  getModelTargetFormat,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";
import { HTTP_STATUS, LOCAL_UPSTREAM_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { detectFormat, getTargetFormat } from "../services/provider.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { FORMATS } from "../translator/formats.js";
import { translateRequest } from "../translator/index.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import {
  createErrorResult,
  formatProviderError,
  parseUpstreamError,
  type ErrorResult,
} from "../utils/error.js";
import { createStreamController } from "../utils/streamHandler.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";

type JsonRecord = Record<string, unknown>;
type ChatLogger = {
  debug?: (scope: string, message: string) => void;
  error?: (scope: string, message: string) => void;
  info?: (scope: string, message: string) => void;
  warn?: (scope: string, message: string) => void;
};
type ClientRawRequest = JsonRecord & {
  body?: unknown;
  endpoint?: string;
  headers?: JsonRecord & { accept?: string };
};
type CachedChatResponse = JsonRecord & {
  choices?: { message?: { content?: string }; [key: string]: unknown }[];
  created?: number;
  id?: string;
  usage?: unknown;
};
type ContentPart = { text?: string; type?: string };
type MemoryRequestBody = JsonRecord & {
  input?: { content?: string | ContentPart[]; role?: string; type?: string }[];
  messages?: { content?: string | ContentPart[]; role?: string }[];
};
type ProviderThinking = { effortMode?: string; mode?: string };
type StreamContent = { content?: string; thinking?: string };

/**
 * Build a streaming SSE Response from a cached (non-streaming) response object.
 * Emits role chunk → content chunk → finish chunk → [DONE].
 */
function buildCacheHitSSEResponse(cached: CachedChatResponse, model: string) {
  const cachedId = cached.id || `chatcmpl-cached-${Date.now().toString(36)}`;
  const created = cached.created || Math.floor(Date.now() / 1000);
  const content = cached.choices?.[0]?.message?.content ?? "";
  const encoder = new TextEncoder();
  const sseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      emit({
        id: cachedId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });
      emit({
        id: cachedId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      });
      emit({
        id: cachedId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: cached.usage,
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-9Router-Cache": "HIT",
    },
  });
}

import { extractFacts } from "@/lib/memory/extraction";
import { injectMemory, shouldInjectMemory } from "@/lib/memory/injection";
import { retrieveMemories } from "@/lib/memory/retrieval";
import { normalizeMemorySettings, toMemoryRetrievalConfig } from "@/lib/memory/settings";
import {
  clearInFlight,
  generateSignature,
  getCachedResponse,
  getInFlight,
  isCacheableForRead,
  isCacheableForWrite,
  setCachedResponse,
  setInFlight,
} from "@/lib/semanticCache";
import { injectCaveman } from "../rtk/caveman.js";

async function createRequestLogger(sourceFormat: string, targetFormat: string, model: string) {
  const { createRequestLogger: createLogger } = await import("../utils/requestLogger.js");
  return createLogger(sourceFormat, targetFormat, model);
}

import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { reserveReasoningTokenBudget } from "../utils/tokenBudget.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { buildOnStreamComplete, handleStreamingResponse } from "./chatCore/streamingHandler.js";

export type ChatCoreResult = { success: true; response: Response } | ErrorResult;

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorCauseName(error: unknown) {
  if (!(error instanceof Error) || !error.cause || typeof error.cause !== "object") return "";
  const cause = error.cause as { name?: unknown };
  return typeof cause.name === "string" ? cause.name : "";
}

function isAbortError(error: unknown) {
  return errorName(error) === "AbortError";
}

export interface ChatCoreParams {
  body: JsonRecord;
  modelInfo: { provider: string; model: string };
  credentials: JsonRecord | null;
  log: ChatLogger | null;
  onCredentialsRefreshed?: (newCreds: JsonRecord) => Promise<void> | void;
  onRequestSuccess?: () => Promise<void> | void;
  onDisconnect?: (reason?: unknown) => Promise<void> | void;
  clientRawRequest?: ClientRawRequest | null;
  connectionId: string;
  userAgent?: string;
  apiKey?: string | null;
  ccFilterNaming?: boolean;
  rtkEnabled?: boolean;
  cavemanEnabled?: boolean;
  cavemanLevel?: string;
  sourceFormatOverride?: string | null;
  providerThinking?: ProviderThinking | null;
  contentFilterMessage?: string | null;
  chatSettings?: JsonRecord;
  memoryOwnerId?: string | null;
  comboName?: string | null;
}

const MAX_SEMANTIC_CACHE_BYTES = 512 * 1024;
const MEMORY_EXTRACTION_TEXT_LIMIT = 64 * 1024;
// Skip cacheability check for request bodies larger than this to avoid a
// synchronous JSON.stringify of a multi-MB payload on every request.
const _MAX_REQUEST_BYTES_FOR_CACHE_CHECK = 512 * 1024;

function isSmallEnoughForSemanticCache(value: unknown) {
  try {
    // Fast-path: estimate size from known string fields before full stringify.
    // choices[0].message.content is the dominant field in a cached response.
    const content = (value as CachedChatResponse)?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.length > MAX_SEMANTIC_CACHE_BYTES) return false;
    return JSON.stringify(value).length <= MAX_SEMANTIC_CACHE_BYTES;
  } catch {
    return false;
  }
}

function toLimitedText(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length <= MEMORY_EXTRACTION_TEXT_LIMIT
    ? trimmed
    : trimmed.slice(trimmed.length - MEMORY_EXTRACTION_TEXT_LIMIT);
}

function extractMemoryTextFromResponse(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const typed = response as CachedChatResponse & { content?: ContentPart[]; output_text?: string };
  const openAIText = typed.choices?.[0]?.message?.content;
  if (typeof openAIText === "string") return toLimitedText(openAIText);
  if (typeof typed.output_text === "string") return toLimitedText(typed.output_text);
  if (Array.isArray(typed.content)) {
    const contentText = typed.content
      .filter((part) => part?.type === "text" && typeof part?.text === "string")
      .map((part) => String(part.text).trim())
      .filter(Boolean)
      .join("\n");
    if (contentText) return toLimitedText(contentText);
  }
  return "";
}

function extractMemoryTextFromRequestBody(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const typed = body as MemoryRequestBody;
  const messages = Array.isArray(typed.messages) ? typed.messages : null;
  if (messages?.length) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg?.role !== "user") continue;
      if (typeof msg?.content === "string" && msg.content.trim()) return toLimitedText(msg.content);
      if (Array.isArray(msg?.content)) {
        const text = msg.content
          .map((part) => {
            if (typeof part?.text === "string") return part.text.trim();
            return "";
          })
          .filter(Boolean)
          .join("\n");
        if (text) return toLimitedText(text);
      }
    }
  }

  const input = Array.isArray(typed.input) ? typed.input : null;
  if (input?.length) {
    for (let i = input.length - 1; i >= 0; i -= 1) {
      const item = input[i];
      const role = typeof item?.role === "string" ? item.role.trim().toLowerCase() : "";
      const itemType = typeof item?.type === "string" ? item.type.trim().toLowerCase() : "";
      if (role && role !== "user") continue;
      if (itemType && itemType !== "message") continue;
      if (typeof item?.content === "string" && item.content.trim())
        return toLimitedText(item.content);
      if (Array.isArray(item?.content)) {
        const text = item.content
          .map((part) => {
            if (typeof part?.text === "string") return part.text.trim();
            return "";
          })
          .filter(Boolean)
          .join("\n");
        if (text) return toLimitedText(text);
      }
    }
  }
  return "";
}

function extractTokensSaved(usage: unknown) {
  if (!usage || typeof usage !== "object") return 0;
  const record = usage as JsonRecord;
  const prompt = Number(record.prompt_tokens ?? record.input_tokens ?? 0) || 0;
  const completion = Number(record.completion_tokens ?? record.output_tokens ?? 0) || 0;
  return prompt + completion;
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
  onDisconnect,
  clientRawRequest,
  connectionId,
  userAgent,
  apiKey,
  ccFilterNaming,
  rtkEnabled,
  cavemanEnabled,
  cavemanLevel,
  sourceFormatOverride,
  providerThinking,
  contentFilterMessage,
  chatSettings,
  memoryOwnerId,
  comboName,
}: ChatCoreParams): Promise<ChatCoreResult> {
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();
  const pipelineSessionId =
    connectionId ||
    `req-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 9)}`;
  const settings = chatSettings || {};
  const semanticCacheEnabled = settings.semanticCacheEnabled !== false;
  const memorySettings = normalizeMemorySettings(settings);

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat || getTargetFormat(provider);
  const stripList = getModelStrip(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high/extra-high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  // Inject provider-level effort override (only if client hasn't set reasoning_effort)
  if (
    providerThinking?.effortMode &&
    providerThinking.effortMode !== "default" &&
    !body.reasoning_effort
  ) {
    body = { ...body, reasoning_effort: providerThinking.effortMode };
  }

  const clientRequestedStreaming =
    body.stream === true ||
    sourceFormat === FORMATS.ANTIGRAVITY ||
    sourceFormat === FORMATS.GEMINI ||
    sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = provider === "openai" || provider === "codex";

  let stream = providerRequiresStreaming ? true : body.stream !== false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  // Only force non-streaming when client explicitly sets stream: false in body.
  // Accept: application/json alone is not enough — some proxies (e.g. omniroute)
  // always send Accept: application/json even for streaming requests.
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (body.stream === false) {
    stream = false;
  } else if (clientPrefersSSE) {
    stream = true;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest)
    reqLogger.logClientRawRequest(
      clientRawRequest.endpoint,
      clientRawRequest.body,
      clientRawRequest.headers,
    );
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Semantic cache pre-check with thundering herd protection
  let cacheSignature = null;
  let resolveInFlight: ((value: unknown) => void) | null = null;
  const messages = body.messages ?? body.input;
  // generateSignature already handles large payloads by hashing only the last
  // 64KB tail (SIGNATURE_MAX_BYTES), so no need to skip cache for large bodies.
  const requestTooLargeForCache = false;
  if (
    semanticCacheEnabled &&
    !requestTooLargeForCache &&
    isCacheableForRead(body, clientRawRequest?.headers)
  ) {
    cacheSignature = generateSignature(
      model,
      messages,
      body.temperature,
      body.top_p,
      memoryOwnerId || null,
    );
    const cached = getCachedResponse(cacheSignature);
    if (cached) {
      reqLogger.logConvertedResponse(cached);
      if (clientRequestedStreaming) {
        return { success: true, response: buildCacheHitSSEResponse(cached, model) };
      }
      return {
        success: true,
        response: new Response(JSON.stringify(cached), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-9Router-Cache": "HIT",
          },
        }),
      };
    }
    // Thundering herd: if an identical request is already in-flight, await its result
    const inFlight = getInFlight(cacheSignature);
    if (inFlight) {
      try {
        const result = await inFlight;
        if (result) {
          reqLogger.logConvertedResponse(result);
          if (clientRequestedStreaming) {
            return { success: true, response: buildCacheHitSSEResponse(result, model) };
          }
          return {
            success: true,
            response: new Response(JSON.stringify(result), {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "X-9Router-Cache": "HIT",
              },
            }),
          };
        }
      } catch {
        // in-flight failed — fall through to upstream
      }
    } else {
      // Register this request as in-flight so concurrent duplicates can await it
      const promise = new Promise<unknown>((resolve) => {
        resolveInFlight = resolve;
      });
      setInFlight(cacheSignature, promise);
    }
  }

  if (
    memoryOwnerId &&
    shouldInjectMemory(body, { enabled: memorySettings.enabled && memorySettings.maxTokens > 0 })
  ) {
    try {
      const memoryQuery = extractMemoryTextFromRequestBody(body);
      const memories = await retrieveMemories(memoryOwnerId, {
        ...toMemoryRetrievalConfig(memorySettings),
        query: memoryQuery || undefined,
      });
      if (memories.length > 0) {
        body = injectMemory(body, memories, provider);
        log?.debug?.("MEMORY", `Injected ${memories.length} memories for key=${memoryOwnerId}`);
      }
    } catch (error: unknown) {
      log?.debug?.("MEMORY", `Memory injection skipped: ${errorMessage(error)}`);
    }
  }

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  let translatedBody: JsonRecord;
  let toolNameMap: unknown;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model };
  } else {
    translatedBody = translateRequest(
      sourceFormat,
      targetFormat,
      model,
      body,
      stream,
      credentials,
      provider,
      reqLogger,
      stripList,
      connectionId,
      clientTool,
    );
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(
        HTTP_STATUS.BAD_REQUEST,
        `Failed to translate request for ${sourceFormat} → ${targetFormat}`,
        undefined,
      );
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = model;
  }

  // Ensure stream flag in body matches resolved stream value.
  // Some upstream proxies (e.g. omniroute) don't inject stream into the body —
  // they rely on Accept header only. Without this, upstream gets stream=undefined
  // and may return non-streaming JSON even when we expect SSE.
  // Exception: Vertex AI does not accept `stream` in the body — streaming is
  // controlled via the URL action suffix (:streamGenerateContent) and ?alt=sse.
  if (targetFormat !== FORMATS.VERTEX) {
    if (stream) {
      translatedBody.stream = true;
    } else {
      translatedBody.stream = false;
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // RTK: compress tool_result content
  // Skip for very large payloads — iterating all messages + running regex
  // autodetect on each tool_result is O(n) and blocks the event loop.
  const rtkStats = compressMessages(translatedBody, rtkEnabled && !requestTooLargeForCache);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  reserveReasoningTokenBudget(translatedBody, { provider, model, targetFormat, log });

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, combo: comboName, status: "PENDING" }).catch(
    () => {},
  );

  const msgCount =
    translatedBody.messages?.length ||
    translatedBody.input?.length ||
    translatedBody.contents?.length ||
    translatedBody.request?.contents?.length ||
    0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const streamController = createStreamController({
    onDisconnect: (reason: unknown) => {
      trackPendingRequest(model, provider, connectionId, false);
      if (onDisconnect) onDisconnect(reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId, false),
    log,
    provider,
    model,
  });

  const proxyOptions: JsonRecord = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | vercel-relay=${proxyOptions.vercelRelayUrl}`,
    );
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`,
    );
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`,
    );
  }

  // Upstream timeout: combined AbortController for client disconnect + upstream deadline
  const upstreamTimeoutMs =
    Number(process.env.API_TIMEOUT_MS) > 0
      ? Number(process.env.API_TIMEOUT_MS)
      : LOCAL_UPSTREAM_TIMEOUT_MS;

  // Pass timeout to proxy layer so Vercel relay can enforce its own AbortController
  proxyOptions.upstreamTimeoutMs = upstreamTimeoutMs;

  const isUpstreamTimeoutError = (error: unknown) =>
    errorName(error) === "TimeoutError" || errorCauseName(error) === "TimeoutError";
  const buildAbortStatus = (error: unknown) =>
    isUpstreamTimeoutError(error) ? HTTP_STATUS.REQUEST_TIMEOUT : 499;
  const createUpstreamSignal = () => {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      const timeoutError = new Error(`Upstream request timed out after ${upstreamTimeoutMs}ms`);
      timeoutError.name = "TimeoutError";
      timeoutController.abort(timeoutError);
    }, upstreamTimeoutMs);
    timeoutId.unref?.();

    const combinedController = new AbortController();
    const forwardAbort = (event: Event) => {
      const reason =
        (event.target as AbortSignal | null)?.reason ||
        timeoutController.signal.reason ||
        streamController.signal.reason;
      combinedController.abort(reason);
    };

    timeoutController.signal.addEventListener("abort", forwardAbort, { once: true });
    streamController.signal.addEventListener("abort", forwardAbort, { once: true });

    return {
      signal: combinedController.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
        timeoutController.signal.removeEventListener("abort", forwardAbort);
        streamController.signal.removeEventListener("abort", forwardAbort);
      },
    };
  };

  const executeUpstream = async () => {
    const { signal, cleanup } = createUpstreamSignal();
    try {
      return await executor.execute({
        model,
        body: translatedBody,
        stream,
        credentials,
        signal,
        log,
        proxyOptions,
        clientHeaders: clientRawRequest?.headers || null,
      });
    } finally {
      cleanup();
    }
  };

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  try {
    const result = await executeUpstream();
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);

    // Fix 4: One-shot retry on Vercel relay 502/504 (cold start mitigation).
    // Vercel free-tier often returns 502/504 on first request after deploy or idle.
    // Retrying once with a brief delay resolves most cold starts transparently.
    if (
      proxyOptions.vercelRelayUrl &&
      (providerResponse.status === 502 || providerResponse.status === 504)
    ) {
      console.error("[VERCEL-RELAY-RETRY] Retrying upstream request after relay 502/504");
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      const retryResult = await executeUpstream();
      providerResponse = retryResult.response;
      providerUrl = retryResult.url;
      providerHeaders = retryResult.headers;
      finalBody = retryResult.transformedBody;
      reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
    }
  } catch (error: unknown) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const abortStatus = buildAbortStatus(error);
    const isTimeout = isUpstreamTimeoutError(error);
    if (isTimeout) {
      console.error(`[TIMEOUT] Upstream request timed out after ${upstreamTimeoutMs}ms`);
    } else {
      console.error("[UPSTREAM ERROR] Upstream request failed");
    }
    appendRequestLog({
      model,
      provider,
      connectionId,
      status: `FAILED ${isAbortError(error) ? abortStatus : HTTP_STATUS.BAD_GATEWAY}`,
    }).catch(() => {
      // Best-effort request log; upstream error response still proceeds.
    });
    saveRequestDetail(
      buildRequestDetail({
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: translatedBody || null,
        response: {
          error: errorMessage(error),
          status: isAbortError(error) ? abortStatus : 502,
          thinking: null,
        },
        status: "error",
      }),
    ).catch(() => {
      // Best-effort request detail; upstream error response still proceeds.
    });

    if (isAbortError(error)) {
      streamController.handleError(error);
      return createErrorResult(
        abortStatus,
        isUpstreamTimeoutError(error)
          ? `Upstream request timed out after ${upstreamTimeoutMs}ms`
          : "Request aborted",
        undefined,
      );
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg, undefined);
  }

  // Fix 2: Detect Vercel platform 504 — free-tier hard-kills functions at 10s.
  // The relay emits a 504 with a JSON error body, but if Vercel itself kills the
  // function before the relay responds, we get a generic platform 504.
  // Surface this as a clear relay-timeout error rather than treating it as an
  // upstream provider failure.
  if (providerResponse && providerResponse.status === 504 && proxyOptions.vercelRelayUrl) {
    console.error("[VERCEL-RELAY-TIMEOUT] Relay request exceeded platform limit");
    return createErrorResult(
      HTTP_STATUS.GATEWAY_TIMEOUT,
      "Vercel relay timeout — function exceeded platform limit",
      undefined,
    );
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (
    !executor.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    try {
      const newCredentials = await refreshWithRetry(
        () => executor.refreshCredentials(credentials, log),
        3,
        log,
      );
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        Object.assign(credentials as JsonRecord, newCredentials);
        if (onCredentialsRefreshed) {
          try {
            await onCredentialsRefreshed(newCredentials);
          } catch (e: unknown) {
            log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${errorMessage(e)}`);
          }
        }
        try {
          const retryResult = await executeUpstream();
          if (retryResult.response.ok) {
            providerResponse = retryResult.response;
            providerUrl = retryResult.url;
          }
        } catch (e: unknown) {
          log?.warn?.(
            "TOKEN",
            `${provider.toUpperCase()} | retry after refresh failed: ${errorMessage(e)}`,
          );
        }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e: unknown) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${errorMessage(e)}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(
      providerResponse,
      executor,
    );
    console.error(`[UPSTREAM ${statusCode}] Upstream provider returned an error`);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(
      () => {
        // Best-effort request log; upstream error response still proceeds.
      },
    );
    saveRequestDetail(
      buildRequestDetail({
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        response: { error: message, status: statusCode, thinking: null },
        status: "error",
      }),
    ).catch(() => {
      // Best-effort request detail; upstream error response still proceeds.
    });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  const sharedCtx = {
    provider,
    model,
    body,
    stream,
    translatedBody,
    finalBody,
    requestStartTime,
    connectionId,
    apiKey,
    clientRawRequest,
    onRequestSuccess,
  };
  const appendLog = (extra: JsonRecord) =>
    appendRequestLog({ model, provider, connectionId, combo: comboName, ...extra }).catch(() => {
      // Best-effort request log; do not disrupt response handling.
    });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      trackDone,
      appendLog,
      onFinalJsonResponse: (finalResponse: unknown, usage: unknown) => {
        if (
          semanticCacheEnabled &&
          cacheSignature &&
          isCacheableForWrite(body, clientRawRequest?.headers) &&
          isSmallEnoughForSemanticCache(finalResponse)
        ) {
          setCachedResponse(cacheSignature, model, finalResponse, extractTokensSaved(usage));
          if (resolveInFlight) {
            resolveInFlight(finalResponse);
            resolveInFlight = null;
          }
        }
        // Always clear in-flight regardless of write-cacheability
        if (cacheSignature) clearInFlight(cacheSignature);
        if (memoryOwnerId && memorySettings.enabled && memorySettings.maxTokens > 0) {
          const requestMemoryText = extractMemoryTextFromRequestBody(body);
          if (requestMemoryText) extractFacts(requestMemoryText, memoryOwnerId, pipelineSessionId);
          const responseMemoryText = extractMemoryTextFromResponse(finalResponse);
          if (responseMemoryText)
            extractFacts(responseMemoryText, memoryOwnerId, pipelineSessionId);
        }
      },
    });
    if (result) {
      streamController.handleComplete();
      return result;
    }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      targetFormat,
      reqLogger,
      toolNameMap,
      trackDone,
      appendLog,
      onFinalJsonResponse: (translatedResponse: unknown, usage: unknown) => {
        if (
          semanticCacheEnabled &&
          cacheSignature &&
          isCacheableForWrite(body, clientRawRequest?.headers) &&
          isSmallEnoughForSemanticCache(translatedResponse)
        ) {
          setCachedResponse(cacheSignature, model, translatedResponse, extractTokensSaved(usage));
          if (resolveInFlight) {
            resolveInFlight(translatedResponse);
            resolveInFlight = null;
          }
        }
        // Always clear in-flight regardless of write-cacheability
        if (cacheSignature) clearInFlight(cacheSignature);
        if (memoryOwnerId && memorySettings.enabled && memorySettings.maxTokens > 0) {
          const requestMemoryText = extractMemoryTextFromRequestBody(body);
          if (requestMemoryText) extractFacts(requestMemoryText, memoryOwnerId, pipelineSessionId);
          const responseMemoryText = extractMemoryTextFromResponse(translatedResponse);
          if (responseMemoryText)
            extractFacts(responseMemoryText, memoryOwnerId, pipelineSessionId);
        }
      },
    });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  // Peek first chunk to detect upstream error payloads (e.g. content_filter_error)
  // returned as HTTP 200 with error in body. Convert to proper error response so
  // downstream proxies (e.g. omniroute) can fallback correctly.
  if (stream && providerResponse.body) {
    let reader;
    try {
      reader = providerResponse.body.getReader();
    } catch (e: unknown) {
      log?.error?.("CHAT_CORE", `Failed to get reader from provider stream: ${errorMessage(e)}`);
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        "Failed to read provider stream",
        undefined,
      );
    }
    const peekResult = await reader.read().catch((e: unknown) => {
      log?.error?.(
        "CHAT_CORE",
        `Failed to peek first chunk from ${provider}/${model}: ${errorMessage(e)}`,
      );
      return { value: null, done: true };
    });
    const { value: firstChunk, done } = peekResult;
    if (!done && firstChunk) {
      const text = new TextDecoder().decode(firstChunk);
      const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
      if (dataLine) {
        const payload = dataLine.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error && !parsed.choices) {
              trackPendingRequest(model, provider, connectionId, false, true);
              reader.cancel().catch(() => {
                // Cleanup only; stream is already returning an upstream error.
              });

              // If contentFilterMessage is set, return a humanistic SSE response
              // instead of a programmatic error so the client sees a natural reply.
              if (contentFilterMessage) {
                const fallbackId = `chatcmpl-${Date.now().toString(36)}`;
                const created = Math.floor(Date.now() / 1000);
                const chunk1 = `data: ${JSON.stringify({ id: fallbackId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: contentFilterMessage }, finish_reason: null }] })}\n\n`;
                const chunk2 = `data: ${JSON.stringify({ id: fallbackId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })}\n\n`;
                const done = "data: [DONE]\n\n";
                const encoder = new TextEncoder();
                const fallbackStream = new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(encoder.encode(chunk1));
                    controller.enqueue(encoder.encode(chunk2));
                    controller.enqueue(encoder.encode(done));
                    controller.close();
                  },
                });
                return {
                  success: true,
                  response: new Response(fallbackStream, {
                    status: 200,
                    headers: {
                      "Content-Type": "text/event-stream",
                      "Cache-Control": "no-cache",
                      Connection: "keep-alive",
                      "Access-Control-Allow-Origin": "*",
                    },
                  }),
                };
              }

              const errMsg = parsed.error.message || "Upstream error";
              const statusCode =
                parsed.error.code === "content_filter" ? 422 : HTTP_STATUS.BAD_GATEWAY;
              return createErrorResult(statusCode, errMsg, undefined);
            }
          } catch {
            // not JSON, continue
          }
        }
      }
      // Reconstruct response with peeked chunk prepended.
      // providerResponse.body is already locked by reader, so pipe via reader.
      const reconstructed = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(firstChunk);
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          } catch (e: unknown) {
            // ponytail: controller.close() on AbortError — controller.error() re-emits the
            // abort to the response writer, which surfaces as unhandledRejection at
            // node:_http_server.
            if (isAbortError(e)) {
              controller.close();
            } else {
              controller.error(e);
            }
          }
        },
        cancel() {
          reader.cancel().catch(() => {
            // Cleanup only; downstream cancellation is already in progress.
          });
        },
      });
      providerResponse = new Response(reconstructed, {
        status: providerResponse.status,
        statusText: providerResponse.statusText,
        headers: providerResponse.headers,
      });
    }
  }

  const { onStreamComplete: baseOnStreamComplete, streamDetailId } = buildOnStreamComplete({
    ...sharedCtx,
  });
  const onStreamComplete = (contentObj: StreamContent, usage: unknown, ttftAt: number | null) => {
    baseOnStreamComplete?.(contentObj, usage, ttftAt);
    appendLog({ tokens: usage, status: "SUCCESS", detailsId: streamDetailId });
    if (memoryOwnerId && memorySettings.enabled && memorySettings.maxTokens > 0) {
      const requestMemoryText = extractMemoryTextFromRequestBody(body);
      if (requestMemoryText) extractFacts(requestMemoryText, memoryOwnerId, pipelineSessionId);
      const streamedText = toLimitedText(contentObj?.content || "");
      if (streamedText) extractFacts(streamedText, memoryOwnerId, pipelineSessionId);
    }
    // Cache the assembled streaming response so future identical requests
    // (even streaming ones) can be served from cache without hitting upstream.
    // We reconstruct a minimal OpenAI-format object — same shape the
    // non-streaming path caches — so getCachedResponse works for both paths.
    if (
      semanticCacheEnabled &&
      cacheSignature &&
      isCacheableForWrite(body, clientRawRequest?.headers) &&
      contentObj?.content
    ) {
      const cachedId = `chatcmpl-cached-${Date.now().toString(36)}`;
      const assembledResponse = {
        id: cachedId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: contentObj.content },
            finish_reason: "stop",
          },
        ],
        usage: usage
          ? {
              prompt_tokens: usage.prompt_tokens ?? 0,
              completion_tokens: usage.completion_tokens ?? 0,
              total_tokens:
                usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
            }
          : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      if (isSmallEnoughForSemanticCache(assembledResponse)) {
        setCachedResponse(cacheSignature, model, assembledResponse, extractTokensSaved(usage));
        if (resolveInFlight) {
          resolveInFlight(assembledResponse);
          resolveInFlight = null;
        }
      } else {
        // Response too large to cache — still resolve in-flight waiters
        if (resolveInFlight) {
          resolveInFlight(null);
          resolveInFlight = null;
        }
      }
    } else if (cacheSignature) {
      // No content or not cacheable — resolve in-flight waiters so they don't stall
      if (resolveInFlight) {
        resolveInFlight(null);
        resolveInFlight = null;
      }
    }
    // Always clear in-flight entry
    if (cacheSignature) clearInFlight(cacheSignature);
  };
  return handleStreamingResponse({
    ...sharedCtx,
    providerResponse,
    sourceFormat,
    targetFormat,
    userAgent,
    reqLogger,
    toolNameMap,
    streamController,
    onStreamComplete,
  });
}

export function isTokenExpiringSoon(expiresAt: unknown, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
