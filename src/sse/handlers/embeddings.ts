import { HTTP_STATUS } from "open-sse/config/runtimeConfig.ts";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.ts";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.ts";
import { getSettings } from "@/lib/localDb";
import { readBodyText } from "@/lib/parseJsonBody";
import { getMaxRequestBodyBytes } from "@/shared/constants/config";
import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth";
import { getModelInfo } from "../services/model";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh";
import * as log from "../utils/logger";

export async function handleEmbeddings(request: Request): Promise<Response> {
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
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const url = new URL(request.url);
  const modelStr = body.model as string | undefined;
  log.request("POST", `${url.pathname} | ${modelStr}`);
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
  if (!modelStr) {
    log.warn("EMBEDDINGS", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }
  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("EMBEDDINGS", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }
  const provider = modelInfo.provider!;
  const model = modelInfo.model;
  if (modelStr !== `${provider}/${model}`)
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  else log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status =
          lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn(
          "EMBEDDINGS",
          `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`,
        );
        return unavailableResponse(
          status,
          `[${provider}/${model}] ${errorMsg}`,
          credentials.retryAfter ?? "",
          credentials.retryAfterHuman ?? "",
        );
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(
        lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        lastError || "All accounts unavailable",
      );
    }
    const connectionId = credentials.connectionId!;
    const connName = credentials.connectionName;
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${connName}\x1b[0m`);
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
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
        await clearAccountError(connectionId, credentials, model);
      },
    });
    if (result.success === true) return result.response;
    const { shouldFallback } = await markAccountUnavailable(
      connectionId,
      result.status,
      result.error,
      provider,
      model,
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
