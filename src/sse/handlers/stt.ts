import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getSettings } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import {
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth";
import { getModelInfo } from "../services/model";
import * as log from "../utils/logger";

const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(
      ([, p]) => p.serviceKinds?.includes("stt") && !p.noAuth && p.sttConfig?.authType !== "none",
    )
    .map(([id]) => id),
);

export async function handleStt(
  request: Request,
  opts: { translate?: boolean } = {},
): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }
  const modelStr = formData.get("model") as string | null;
  log.request(
    "POST",
    `/v1/audio/transcriptions | ${modelStr}${opts.translate ? " | translate" : ""}`,
  );
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  if (opts.translate && modelStr && !/^whisper(-1)?$/i.test(modelStr)) {
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      "Translations are only supported with the whisper-1 model",
    );
  }
  if (opts.translate) formData.delete("language");
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!formData.get("file"))
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const provider = modelInfo.provider!;
  const model = modelInfo.model;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleSttCore({ provider, model, formData, translate: opts.translate });
    if (result.success === true) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "STT failed");
  }
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status =
          lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(
          status,
          `[${provider}/${model}] ${msg}`,
          credentials.retryAfter ?? null,
          credentials.retryAfterHuman ?? "",
        );
      }
      if (excludeConnectionIds.size === 0)
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(
        lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        lastError || "All accounts unavailable",
      );
    }
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);
    const connectionId = credentials.connectionId!;
    const result = await handleSttCore({
      provider,
      model,
      formData,
      credentials: credentials as Record<string, unknown>,
      translate: opts.translate,
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
      excludeConnectionIds.add(connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return errorResponse(result.status, result.error);
  }
}
