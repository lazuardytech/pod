import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleTtsCore } from "open-sse/handlers/ttsCore.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getSettings } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { extractApiKey, getProviderCredentials, isValidApiKey, markAccountUnavailable } from "../services/auth";
import { getComboModels, getModelInfo } from "../services/model";
import * as log from "../utils/logger";

const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("tts") && !p.noAuth && p.ttsConfig?.authType !== "none")
    .map(([id]) => id),
);

export async function handleTts(request: Request): Promise<Response> {
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const url = new URL(request.url);
  const modelStr = body.model as string | undefined;
  const responseFormat = url.searchParams.get("response_format") || "mp3";
  const language = body.language || "";
  log.request(
    "POST",
    `${url.pathname} | ${modelStr} | format=${responseFormat}${language ? ` | lang=${language}` : ""}`,
  );
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = (settings.comboStrategies || {}) as Record<string, Record<string, unknown>>;
    const comboStrategy =
      (comboStrategies[modelStr]?.fallbackStrategy as string) || (settings.comboStrategy as string) || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit as number | undefined;
    log.info(
      "TTS",
      `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
    );
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelTts(b, m, responseFormat, language),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }
  return handleSingleModelTts(body, modelStr, responseFormat, language);
}

async function handleSingleModelTts(
  body: Record<string, any>,
  modelStr: string,
  responseFormat: string,
  language: string,
): Promise<Response> {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const provider = modelInfo.provider!;
  const model = modelInfo.model;
  log.info("ROUTING", `Provider: ${provider}, Voice: ${model}`);
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleTtsCore({ provider, model, input: body.input, responseFormat, language });
    if (result.success === true) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "TTS failed");
  }
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(
          status,
          `[${provider}/${model}] ${msg}`,
          credentials.retryAfter ?? null,
          credentials.retryAfterHuman ?? "",
        );
      }
      if (excludeConnectionIds.size === 0)
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);
    const connectionId = credentials.connectionId!;
    const result = await handleTtsCore({
      provider,
      model,
      input: body.input,
      credentials: credentials as Record<string, unknown>,
      responseFormat,
      language,
    });
    if (result.success === true) return result.response;
    const { shouldFallback } = await markAccountUnavailable(connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return errorResponse(result.status, result.error);
  }
}
