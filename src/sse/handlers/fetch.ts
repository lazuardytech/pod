import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleFetchCore } from "open-sse/handlers/fetch/index.js";
import { getComboModelsFromData, handleComboChat } from "open-sse/services/combo.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getCombos, getSettings } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId, type ProviderDefinition } from "@/shared/constants/providers";
import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh";
import * as log from "../utils/logger";

export async function handleFetch(request: Request): Promise<Response> {
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    log.warn("FETCH", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const reqUrl = new URL(request.url);
  const providerInput = (body.provider || body.model) as string | undefined;
  const targetUrl = body.url as string | undefined;
  const _format = body.format;
  const _maxCharacters = body.max_characters;
  log.request("POST", `${reqUrl.pathname} | ${providerInput}`);
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
    log.warn("FETCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }
  if (!targetUrl || typeof targetUrl !== "string") {
    log.warn("FETCH", "Missing url");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: url");
  }
  try {
    new URL(targetUrl);
  } catch {
    log.warn("FETCH", "Invalid URL", { url: targetUrl });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid URL format");
  }
  const combos = await getCombos();
  const comboModels = getComboModelsFromData(providerInput, combos as unknown as { name: string; models: string[] }[]);
  if (comboModels) {
    const comboStrategies = (settings.comboStrategies || {}) as Record<string, Record<string, unknown>>;
    const comboStrategy =
      (comboStrategies[providerInput]?.fallbackStrategy as string) || (settings.comboStrategy as string) || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit as number | undefined;
    log.info(
      "FETCH",
      `Combo "${providerInput}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
    );
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleProviderFetch(b, m, request, apiKey, settings),
      log,
      comboName: providerInput,
      comboStrategy,
      comboStickyLimit,
    });
  }
  return handleSingleProviderFetch(body, providerInput, request, apiKey, settings);
}

async function handleSingleProviderFetch(
  body: Record<string, any>,
  providerInput: string,
  request: Request,
  apiKey: string | null,
  settings: any,
): Promise<Response> {
  const targetUrl = body.url as string;
  const format = body.format;
  const maxCharacters = body.max_characters;
  const providerId = resolveProviderId(providerInput);
  const resolvedProvider: ProviderDefinition | undefined = AI_PROVIDERS[providerId];
  if (!resolvedProvider) {
    log.warn("FETCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }
  const providerConfig = resolvedProvider.fetchConfig;
  if (!providerConfig) {
    log.warn("FETCH", "Provider does not support web fetch", { provider: providerId });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${providerId} does not support web fetch`);
  }
  if (providerInput !== providerId) log.info("ROUTING", `${providerInput} → ${providerId}`);
  else log.info("ROUTING", `Provider: ${providerId}`);
  if (resolvedProvider.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleFetchCore({
      url: targetUrl,
      format,
      maxCharacters,
      provider: resolvedProvider.id,
      providerConfig,
      credentials: null,
      log: log as unknown,
    });
    if (result.success === true) {
      return new Response(JSON.stringify(result.data), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Fetch failed");
  }
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  while (true) {
    const credentials = await getProviderCredentials(providerId, excludeConnectionIds);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("FETCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(
          status,
          `[${providerId}] ${errorMsg}`,
          credentials.retryAfter ?? null,
          credentials.retryAfterHuman ?? "",
        );
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("FETCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }
    const connectionId = credentials.connectionId!;
    const connName = credentials.connectionName;
    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${connName}\x1b[0m`);
    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);
    const result = await handleFetchCore({
      url: targetUrl,
      format,
      maxCharacters,
      provider: resolvedProvider.id,
      providerConfig,
      credentials: refreshedCredentials,
      log: log as unknown,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(connectionId, {
          accessToken: newCreds.accessToken as string | undefined,
          refreshToken: newCreds.refreshToken as string | undefined,
          providerSpecificData: newCreds.providerSpecificData as Record<string, unknown> | undefined,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(connectionId, credentials);
      },
    });
    if (result.success === true) {
      return new Response(JSON.stringify(result.data), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    const { shouldFallback } = await markAccountUnavailable(connectionId, result.status, result.error, providerId);
    if (shouldFallback) {
      log.warn("AUTH", `Account ${connName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Fetch failed");
  }
}
