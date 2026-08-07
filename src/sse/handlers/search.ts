import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleSearchCore } from "open-sse/handlers/search/index.js";
import { getComboModelsFromData, handleComboChat } from "open-sse/services/combo.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getCombos, getSettings, type Settings } from "@/lib/localDb";
import { readBodyText } from "@/lib/parseJsonBody";
import { getMaxRequestBodyBytes } from "@/shared/constants/config";
import {
  AI_PROVIDERS,
  type ProviderDefinition,
  resolveProviderId,
} from "@/shared/constants/providers";
import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh";
import * as log from "../utils/logger";

export async function handleSearch(request: Request): Promise<Response> {
  const bodyResult = await readBodyText(request, {
    maxBytes: getMaxRequestBodyBytes(false),
  });
  if (!bodyResult.ok) {
    if (bodyResult.reason === "aborted") {
      return errorResponse(499, "Client disconnected");
    }
    if (bodyResult.reason === "too_large") {
      return errorResponse(413, "Request body too large");
    }
    const _exhaustive: never = bodyResult;
    void _exhaustive;
    return errorResponse(500, "Internal error");
  }
  let body: Record<string, any>;
  try {
    body = JSON.parse(bodyResult.text);
  } catch {
    log.warn("SEARCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const url = new URL(request.url);
  const providerInput = (body.provider || body.model) as string | undefined;
  const query = body.query as string | undefined;
  log.request("POST", `${url.pathname} | ${providerInput}`);
  const apiKey = extractApiKey(request);
  if (apiKey) log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
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
  if (!providerInput || typeof providerInput !== "string") {
    log.warn("SEARCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }
  if (!query || typeof query !== "string" || !query.trim()) {
    log.warn("SEARCH", "Missing query");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  }
  const combos = await getCombos();
  const comboModels = getComboModelsFromData(
    providerInput,
    combos as unknown as { name: string; models: string[] }[],
  );
  if (comboModels) {
    const comboStrategies = (settings.comboStrategies || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const comboStrategy =
      (comboStrategies[providerInput]?.fallbackStrategy as string) ||
      (settings.comboStrategy as string) ||
      "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit as number | undefined;
    log.info(
      "SEARCH",
      `Combo "${providerInput}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
    );
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleProviderSearch(b, m, request, apiKey, settings),
      log,
      comboName: providerInput,
      comboStrategy,
      comboStickyLimit,
    });
  }
  return handleSingleProviderSearch(body, providerInput, request, apiKey, settings);
}

async function handleSingleProviderSearch(
  body: Record<string, any>,
  providerInput: string,
  _request: Request,
  _apiKey: string | null,
  _settings: Settings,
): Promise<Response> {
  const query = body.query as string;
  const providerId = resolveProviderId(providerInput);
  const resolvedProvider: ProviderDefinition | undefined = AI_PROVIDERS[providerId];
  if (!resolvedProvider) {
    log.warn("SEARCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }
  const providerConfig = resolvedProvider.searchConfig;
  const supportsSearch = !!providerConfig || !!resolvedProvider.searchViaChat;
  if (!supportsSearch) {
    log.warn("SEARCH", "Provider does not support web search", { provider: providerId });
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Provider ${providerId} does not support web search`,
    );
  }
  if (providerInput !== providerId) log.info("ROUTING", `${providerInput} → ${providerId}`);
  else log.info("ROUTING", `Provider: ${providerId}`);
  const coreBody = {
    query: query.trim(),
    provider: providerId,
    max_results: body.max_results,
    search_type: body.search_type,
    country: body.country,
    language: body.language,
    time_range: body.time_range,
    offset: body.offset,
    domain_filter: body.domain_filter,
    content_options: body.content_options,
    provider_options: body.provider_options,
  };
  if (resolvedProvider.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: null,
      log: log as unknown,
    });
    if (result.success === true) return result.response;
    return errorResponse(result.status, result.error);
  }
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  while (true) {
    const credentials = await getProviderCredentials(providerId, excludeConnectionIds);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status =
          lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SEARCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(
          status,
          `[${providerId}] ${errorMsg}`,
          credentials.retryAfter ?? "",
          credentials.retryAfterHuman ?? "",
        );
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, "Model not available");
      }
      log.warn("SEARCH", "No more accounts available", { provider: providerId });
      return errorResponse(
        lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        lastError || "All accounts unavailable",
      );
    }
    const connectionId = credentials.connectionId!;
    const connName = credentials.connectionName;
    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${connName}\x1b[0m`);
    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: refreshedCredentials,
      log: log as unknown,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(connectionId, {
          accessToken: newCreds.accessToken as string | undefined,
          refreshToken: newCreds.refreshToken as string | undefined,
          providerSpecificData: newCreds.providerSpecificData as
            | Record<string, unknown>
            | undefined,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(connectionId, credentials);
      },
    });
    if (result.success === true) return result.response;
    const { shouldFallback } = await markAccountUnavailable(
      connectionId,
      result.status,
      result.error,
      providerId,
    );
    if (shouldFallback) {
      log.warn("AUTH", `Account ${connName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return errorResponse(result.status, result.error);
  }
}
