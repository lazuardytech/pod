import "open-sse/index.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import {
  handleComboChat,
  injectComboSystemPrompt,
  overrideResponseModelId,
} from "open-sse/services/combo.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getApiKeyByKey, getSettings } from "@/lib/localDb";
import { readBodyTextStream } from "@/lib/parseJsonBody";
import { MAX_CHAT_BODY_BYTES } from "@/shared/constants/config";
import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth";
import { getComboInfo, getModelInfo } from "../services/model";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh";
import * as log from "../utils/logger";

// ponytail: module-level SSE connection cap, global counter; per-route counters if multi-instance matters
let activeSseConnections = 0;
const MAX_SSE_CONNECTIONS = 100;

export async function handleChat(
  request: Request,
  clientRawRequest: unknown = null,
): Promise<Response> {
  const t0 = performance.now();
  const bodyResult = await readBodyTextStream(request, { maxBytes: MAX_CHAT_BODY_BYTES });
  const t1 = performance.now();
  if (!bodyResult.ok) {
    const userAgent = request?.headers?.get("user-agent") || "";
    if (bodyResult.reason === "aborted") {
      log.info("CHAT", "Client disconnected before body read");
      log.debug(
        "CHAT",
        `body=0B ua="${userAgent.slice(0, 40)}" t_read=${(t1 - t0).toFixed(0)}ms t_parse=0ms t_bypass=0ms`,
      );
      return errorResponse(499, "Client disconnected");
    }
    if (bodyResult.reason === "too_large") {
      log.warn("CHAT", `Request body too large (max ${bodyResult.maxBytes} bytes)`);
      log.debug(
        "CHAT",
        `body=>${bodyResult.maxBytes}B ua="${userAgent.slice(0, 40)}" t_read=${(t1 - t0).toFixed(0)}ms t_parse=0ms t_bypass=0ms`,
      );
      return errorResponse(413, "Request body too large");
    }
    const _exhaustive: never = bodyResult;
    void _exhaustive;
    return errorResponse(HTTP_STATUS.SERVER_ERROR, "Internal error");
  }
  let body: Record<string, any>;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    const userAgent = request?.headers?.get("user-agent") || "";
    log.warn("CHAT", "Invalid JSON body");
    log.debug(
      "CHAT",
      `body=${bodyResult.text.length}B ua="${userAgent.slice(0, 40)}" t_read=${(t1 - t0).toFixed(0)}ms t_parse=${(performance.now() - t1).toFixed(0)}ms t_bypass=0ms`,
    );
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const t2 = performance.now();

  // Check SSE connection cap before processing
  if (body.stream && activeSseConnections >= MAX_SSE_CONNECTIONS) {
    log.warn("CHAT", `SSE connection cap reached (${activeSseConnections}/${MAX_SSE_CONNECTIONS})`);
    return errorResponse(429, "Too many streaming connections. Please retry later.");
  }
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries()),
    };
  }
  cacheClaudeHeaders((clientRawRequest as { headers: Record<string, string> }).headers);
  const url = new URL(request.url);
  const modelStr = body.model as string | undefined;
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request(
    "POST",
    `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`,
  );
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  const apiKeyRecord = apiKey ? await getApiKeyByKey(apiKey).catch((): null => null) : null;
  const apiKeyId = (apiKeyRecord as { id?: string } | null)?.id || null;
  if (authHeader && apiKey) log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  else log.debug("AUTH", "No API key provided (local mode)");
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }
  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  const t3 = performance.now();
  log.debug(
    "CHAT",
    `body=${bodyResult.text.length}B ua="${userAgent.slice(0, 40)}" t_read=${(t1 - t0).toFixed(0)}ms t_parse=${(t2 - t1).toFixed(0)}ms t_bypass=${(t3 - t2).toFixed(0)}ms`,
  );
  if (bypassResponse) {
    if ("response" in bypassResponse && bypassResponse.response) return bypassResponse.response;
    return bypassResponse as unknown as Response;
  }
  const comboInfo = await getComboInfo(modelStr);
  if (comboInfo) {
    if (comboInfo.systemPrompt) {
      injectComboSystemPrompt(body, comboInfo.systemPrompt);
      log.info(
        "CHAT",
        `Combo "${modelStr}" injecting system prompt (${comboInfo.systemPrompt.length} chars)`,
      );
    }
    const comboStrategies = (settings.comboStrategies || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy as string | undefined;
    const comboStrategy = comboSpecificStrategy || (settings.comboStrategy as string) || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit as number | undefined;
    log.info(
      "CHAT",
      `Combo "${modelStr}" with ${comboInfo.models.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
    );
    const comboResponse = await handleComboChat({
      body,
      models: comboInfo.models,
      handleSingleModel: (b, m): Promise<Response> =>
        handleSingleModelChat(
          b,
          m,
          clientRawRequest,
          request,
          apiKey,
          comboInfo.contentFilterMessage,
          apiKeyId,
          modelStr,
        ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
    if (comboInfo.modelId) return await overrideResponseModelId(comboResponse, comboInfo.modelId);
    return comboResponse;
  }
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, null, apiKeyId);
}

async function handleSingleModelChat(
  body: Record<string, any>,
  modelStr: string,
  clientRawRequest: unknown = null,
  request: Request | null = null,
  apiKey: string | null = null,
  contentFilterMessage: string | null = null,
  apiKeyId: string | null = null,
  comboName: string | null = null,
): Promise<Response> {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    const comboInfo = await getComboInfo(modelStr);
    if (comboInfo) {
      const chatSettings = await getSettings();
      if (comboInfo.systemPrompt) {
        injectComboSystemPrompt(body, comboInfo.systemPrompt);
        log.info(
          "CHAT",
          `Combo "${modelStr}" injecting system prompt (${comboInfo.systemPrompt.length} chars)`,
        );
      }
      const comboStrategies = (chatSettings.comboStrategies || {}) as Record<
        string,
        Record<string, unknown>
      >;
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy as
        | string
        | undefined;
      const comboStrategy =
        comboSpecificStrategy || (chatSettings.comboStrategy as string) || "fallback";
      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit as number | undefined;
      log.info(
        "CHAT",
        `Combo "${modelStr}" with ${comboInfo.models.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
      );
      const innerComboResponse = await handleComboChat({
        body,
        models: comboInfo.models,
        handleSingleModel: (b, m): Promise<Response> =>
          handleSingleModelChat(
            b,
            m,
            clientRawRequest,
            request,
            apiKey,
            comboInfo.contentFilterMessage,
            apiKeyId,
            modelStr,
          ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
      });
      if (comboInfo.modelId)
        return await overrideResponseModelId(innerComboResponse, comboInfo.modelId);
      return innerComboResponse;
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }
  const provider = modelInfo.provider!;
  const model = modelInfo.model;
  if (modelStr !== `${provider}/${model}`)
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  else log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  const userAgent = request?.headers?.get("user-agent") || "";
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  const MAX_FALLBACK_ITERATIONS = 50;
  while (true) {
    if (excludeConnectionIds.size >= MAX_FALLBACK_ITERATIONS) {
      log.error(
        "CHAT",
        `Exceeded max fallback iterations (${MAX_FALLBACK_ITERATIONS}) for ${provider}/${model}`,
      );
      return errorResponse(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        `All accounts exhausted after ${MAX_FALLBACK_ITERATIONS} attempts`,
      );
    }
    let credentials: Awaited<ReturnType<typeof getProviderCredentials>> | null = null;
    try {
      credentials = await getProviderCredentials(provider, excludeConnectionIds, model);
      if (!credentials || credentials.allRateLimited) {
        if (credentials?.allRateLimited) {
          const errorMsg = lastError || credentials.lastError || "Unavailable";
          const status =
            lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
          log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
          return unavailableResponse(
            status,
            `[${provider}/${model}] ${errorMsg}`,
            credentials.retryAfter ?? null,
            credentials.retryAfterHuman ?? "",
          );
        }
        if (excludeConnectionIds.size === 0) {
          log.warn("AUTH", `No active credentials for provider: ${provider}`);
          return errorResponse(HTTP_STATUS.NOT_FOUND, "Model not found");
        }
        log.warn("CHAT", "No more accounts available", { provider });
        return errorResponse(
          lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
          lastError || "All accounts unavailable",
        );
      }
      const connectionId = credentials.connectionId!;
      const connName = credentials.connectionName;
      log.info("AUTH", `\x1b[32mUsing ${provider} account: ${connName}\x1b[0m`);
      const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
      if (
        (provider === "antigravity" || provider === "gemini-cli") &&
        !refreshedCredentials.projectId
      ) {
        const pid = await getProjectIdForConnection(
          connectionId,
          refreshedCredentials.accessToken ?? "",
        );
        if (pid) {
          refreshedCredentials.projectId = pid;
          updateProviderCredentials(connectionId, { projectId: pid }).catch((): void => {});
        }
      }
      const chatSettings = await getSettings();
      const providerThinking =
        ((chatSettings.providerThinking || {}) as Record<string, any>)[provider] || null;
      const result = await handleChatCore({
        body: { ...body, model: `${provider}/${model}` },
        modelInfo: { provider, model },
        credentials: refreshedCredentials,
        log,
        clientRawRequest,
        connectionId,
        userAgent,
        apiKey,
        ccFilterNaming: !!chatSettings.ccFilterNaming,
        rtkEnabled: !!chatSettings.rtkEnabled,
        cavemanEnabled: !!chatSettings.cavemanEnabled,
        cavemanLevel: chatSettings.cavemanLevel || "full",
        providerThinking,
        contentFilterMessage,
        chatSettings,
        memoryOwnerId: apiKeyId,
        comboName,
        sourceFormatOverride: request?.url
          ? detectFormatByEndpoint(new URL(request.url).pathname, body)
          : null,
        onCredentialsRefreshed: async (newCreds): Promise<void> => {
          await updateProviderCredentials(connectionId, {
            accessToken: newCreds.accessToken as string | undefined,
            refreshToken: newCreds.refreshToken as string | undefined,
            providerSpecificData: newCreds.providerSpecificData as
              | Record<string, unknown>
              | undefined,
            testStatus: "active",
          });
        },
        onRequestSuccess: async (): Promise<void> => {
          await clearAccountError(connectionId, credentials!, model);
        },
      });
      if (result.success === true) {
        // Track SSE connection lifetime for connection cap
        const resp = result.response;
        if (resp?.body && body.stream) {
          activeSseConnections++;
          const reader = resp.body.getReader();
          let streamDone = false;
          const newStream = new ReadableStream({
            async pull(controller) {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  streamDone = true;
                  controller.close();
                  return;
                }
                controller.enqueue(value);
              } catch {
                // ponytail: controller.close() on abort — controller.error() re-emits the
                // abort to the response writer, which surfaces as unhandledRejection at
                // node:_http_server.
                streamDone = true;
                controller.close();
              } finally {
                if (streamDone) activeSseConnections--;
              }
            },
            cancel() {
              if (!streamDone) {
                streamDone = true;
                activeSseConnections--;
              }
              reader.cancel().catch(() => {});
            },
          });
          return new Response(newStream, { status: resp.status, headers: resp.headers });
        }
        return resp;
      }
      const { shouldFallback } = await markAccountUnavailable(
        connectionId,
        result.status,
        result.error,
        provider,
        model,
        result.resetsAtMs,
      );
      if (shouldFallback) {
        log.warn("AUTH", `Account ${connName} unavailable (${result.status}), trying fallback`);
        excludeConnectionIds.add(connectionId);
        lastError = result.error;
        lastStatus = result.status;
        continue;
      }
      return errorResponse(result.status, result.error);
    } catch (err) {
      log.error(
        "CHAT",
        `Unexpected error in fallback loop for ${provider}/${model}:`,
        (err as { message?: string })?.message || err,
      );
      excludeConnectionIds.add(credentials?.connectionId || "unknown");
      lastError = (err as { message?: string })?.message || "Unexpected error";
      lastStatus = HTTP_STATUS.SERVER_ERROR;
      continue;
    }
  }
}
