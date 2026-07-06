import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { getSettings } from "@/lib/localDb";
import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth";
import { getComboModels, getModelInfo } from "../services/model";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh";
import * as log from "../utils/logger";

const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui"]);
type ImageGenOptions = {
  wantsStream: boolean;
  binaryOutput: boolean;
  preferredConnectionId: string | null;
};

export async function handleImageGeneration(request: Request): Promise<Response> {
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  const url = new URL(request.url);
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const wantsStream = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput = url.searchParams.get("response_format") === "binary";
  const modelStr = body.model as string | undefined;
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = (settings.comboStrategies || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const comboStrategy =
      (comboStrategies[modelStr]?.fallbackStrategy as string) ||
      (settings.comboStrategy as string) ||
      "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit as number | undefined;
    log.info(
      "IMAGE",
      `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`,
    );
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) =>
        handleSingleModelImage(b, m, { wantsStream, binaryOutput, preferredConnectionId }),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }
  return handleSingleModelImage(body, modelStr, {
    wantsStream,
    binaryOutput,
    preferredConnectionId,
  });
}

async function handleSingleModelImage(
  body: Record<string, any>,
  modelStr: string,
  { wantsStream, binaryOutput, preferredConnectionId }: ImageGenOptions = {
    wantsStream: false,
    binaryOutput: false,
    preferredConnectionId: null,
  },
): Promise<Response> {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const provider = modelInfo.provider!;
  const model = modelInfo.model;
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: null,
      binaryOutput,
    });
    if (result.success === true) return result.response;
    return errorResponse(
      result.status || HTTP_STATUS.BAD_GATEWAY,
      result.error || "Image generation failed",
    );
  }
  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, {
      preferredConnectionId,
    });
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status =
          lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(
          status,
          `[${provider}/${model}] ${errorMsg}`,
          credentials.retryAfter ?? null,
          credentials.retryAfterHuman ?? "",
        );
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(
        lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
        lastError || "All accounts unavailable",
      );
    }
    const connectionId = credentials.connectionId!;
    const connName = credentials.connectionName;
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      streamToClient: wantsStream,
      binaryOutput,
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
