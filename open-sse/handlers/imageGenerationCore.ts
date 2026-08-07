import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import type { ExecutorCredentials } from "../executors/base.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import {
  createErrorResult,
  formatProviderError,
  parseUpstreamError,
  type ErrorResult,
} from "../utils/error.js";
import {
  urlToBase64,
  type ImageRequestBody,
  type ProviderCredentials,
} from "./imageProviders/_base.js";
import { getImageAdapter } from "./imageProviders/index.js";

type JsonRecord = Record<string, unknown>;

type ImageLogger = {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
};

export type ImageGenResult = { success: true; response: Response } | ErrorResult;

export interface ImageGenCoreParams {
  body: ImageRequestBody;
  modelInfo: { provider: string; model: string };
  credentials: ProviderCredentials;
  log?: ImageLogger | null;
  binaryOutput?: boolean;
  streamToClient?: boolean;
  onCredentialsRefreshed?: (newCreds: JsonRecord) => Promise<void> | void;
  onRequestSuccess?: () => Promise<void> | void;
}

function serializeRequestBody(requestBody: unknown) {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Core image generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./imageProviders/{id}.js`.
 */
export async function handleImageGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  streamToClient = false,
  binaryOutput = false,
  onCredentialsRefreshed,
  onRequestSuccess,
}: ImageGenCoreParams): Promise<ImageGenResult> {
  const { provider, model } = modelInfo;

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt", undefined);
  }

  const adapter = getImageAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support image generation`,
      undefined,
    );
  }

  let url;
  let headers;
  let requestBody;

  try {
    url = adapter.buildUrl(model, credentials) as string;
    requestBody = await adapter.buildBody(model, body);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error: unknown) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      errorMessage(error) || `Invalid ${provider} image request`,
      undefined,
    );
  }

  log?.debug?.(
    "IMAGE",
    `${provider.toUpperCase()} | ${model} | prompt="${String(body.prompt).slice(0, 50)}..."`,
  );

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
    });
  } catch (error: unknown) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg, undefined);
  }

  // Handle 401/403 — try token refresh (skipped for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    !adapter.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      async () => {
        const refreshed = await executor.refreshCredentials(
          (credentials || {}) as ExecutorCredentials,
          log ?? null,
        );
        return refreshed as
          | (Record<string, unknown> & {
              accessToken?: string;
              apiKey?: string;
              refreshToken?: string;
              expiresIn?: number;
              expiresAt?: number;
              token?: string;
            })
          | null;
      },
      3,
      log ?? null,
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for image generation`);
      if (credentials) Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryBody = await adapter.buildBody(model, body);
        const retryHeaders = adapter.buildHeaders(credentials, retryBody, model, body);
        const retryUrl = adapter.buildUrl(model, credentials) as string;
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: serializeRequestBody(retryBody),
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("IMAGE", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg, undefined);
  }

  // Parse provider response — adapter may override (codex SSE / async polling / binary)
  let parsed: unknown;
  try {
    if (adapter.parseResponse) {
      parsed = await adapter.parseResponse(providerResponse, {
        headers,
        log: log ?? undefined,
        streamToClient,
        onRequestSuccess,
        url,
        requestBody,
        model,
        body,
      });
      // Codex streaming case: returns an SSE Response directly
      const parsedRecord =
        parsed && typeof parsed === "object" ? (parsed as { sseResponse?: Response }) : {};
      if (parsedRecord.sseResponse) {
        return { success: true, response: parsedRecord.sseResponse };
      }
    } else {
      parsed = await providerResponse.json();
    }
  } catch (parseError: unknown) {
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      errorMessage(parseError) || `Invalid response from ${provider}`,
      undefined,
    );
  }

  if (onRequestSuccess) await onRequestSuccess();

  // Normalize → OpenAI-compatible shape
  const normalized = adapter.normalize(parsed, body.prompt) as {
    created?: unknown;
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  // Already in OpenAI shape? skip re-normalize
  const finalBody =
    normalized.created && Array.isArray(normalized.data)
      ? normalized
      : (parsed as { data?: Array<{ b64_json?: string; url?: string }> });

  // Binary output: decode first b64_json (or fetch url) into raw bytes
  if (binaryOutput) {
    const first = finalBody.data?.[0];
    let b64 = first?.b64_json;
    if (!b64 && first?.url) {
      try {
        b64 = await urlToBase64(first.url);
      } catch {}
    }
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      const fmt = String(body.output_format || "png").toLowerCase();
      const mime =
        fmt === "jpeg" || fmt === "jpg"
          ? "image/jpeg"
          : fmt === "webp"
            ? "image/webp"
            : "image/png";
      return {
        success: true,
        response: new Response(buf, {
          headers: {
            "Content-Type": mime,
            "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`,
            "Access-Control-Allow-Origin": "*",
          },
        }),
      };
    }
  }

  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
