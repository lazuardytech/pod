import "open-sse/index.js";

import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { handleComboChat, injectComboSystemPrompt, overrideResponseModelId } from "open-sse/services/combo.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getApiKeyByKey, getSettings } from "@/lib/localDb";
import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth.js";
import { getComboInfo, getModelInfo } from "../services/model.js";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh.js";
import * as log from "../utils/logger.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  // Read body text first to enforce size limit
  const text = await request.text();
  if (text.length > 10 * 1024 * 1024) {
    log.warn("CHAT", "Request body too large");
    return errorResponse(413, "Request body too large");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries()),
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  // Log request endpoint and model
  const url = new URL(request.url);
  const modelStr = body.model;

  // Count messages (support both messages[] and input[] formats)
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request(
    "POST",
    `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`,
  );

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  const apiKeyRecord = apiKey ? await getApiKeyByKey(apiKey).catch(() => null) : null;
  const apiKeyId = apiKeyRecord?.id || null;
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
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

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboInfo = await getComboInfo(modelStr);
  if (comboInfo) {
    // Inject combo-level system prompt (if any) before fallback loop so every
    // attempted model receives it.
    if (comboInfo.systemPrompt) {
      injectComboSystemPrompt(body, comboInfo.systemPrompt);
      log.info("CHAT", `Combo "${modelStr}" injecting system prompt (${comboInfo.systemPrompt.length} chars)`);
    }
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info(
      "CHAT",
      `Combo "${modelStr}" with ${comboInfo.models.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
    );
    const comboResponse = await handleComboChat({
      body,
      models: comboInfo.models,
      handleSingleModel: (b, m) =>
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

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, null, apiKeyId);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(
  body,
  modelStr,
  clientRawRequest = null,
  request = null,
  apiKey = null,
  contentFilterMessage = null,
  apiKeyId = null,
  comboName = null,
) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboInfo = await getComboInfo(modelStr);
    if (comboInfo) {
      const chatSettings = await getSettings();
      if (comboInfo.systemPrompt) {
        injectComboSystemPrompt(body, comboInfo.systemPrompt);
        log.info("CHAT", `Combo "${modelStr}" injecting system prompt (${comboInfo.systemPrompt.length} chars)`);
      }
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info(
        "CHAT",
        `Combo "${modelStr}" with ${comboInfo.models.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
      );
      const innerComboResponse = await handleComboChat({
        body,
        models: comboInfo.models,
        handleSingleModel: (b, m) =>
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
      if (comboInfo.modelId) return await overrideResponseModelId(innerComboResponse, comboInfo.modelId);
      return innerComboResponse;
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Log model routing (alias → actual model)
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(
          status,
          `[${provider}/${model}] ${errorMsg}`,
          credentials.retryAfter,
          credentials.retryAfterHuman,
        );
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Log account selection
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => {});
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
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
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
    });

    if (result.success) return result.response;

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      provider,
      model,
      result.resetsAtMs,
    );

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
