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
import { getEmbeddingAdapter } from "./embeddingProviders/index.js";

type JsonRecord = Record<string, unknown>;

type EmbeddingsLogger = {
  debug?: (tag: string, message: string, data?: unknown) => void;
  info?: (tag: string, message: string, data?: unknown) => void;
  warn?: (tag: string, message: string, data?: unknown) => void;
};

export type EmbeddingsResult = { success: true; response: Response } | ErrorResult;

export interface EmbeddingsCoreParams {
  body: JsonRecord & {
    input?: unknown;
    encoding_format?: string;
    dimensions?: number;
  };
  modelInfo: { provider: string; model: string };
  credentials: JsonRecord | null;
  log: EmbeddingsLogger | null;
  onCredentialsRefreshed?: (newCreds: JsonRecord) => Promise<void> | void;
  onRequestSuccess?: () => Promise<void> | void;
}

/**
 * Core embeddings handler — orchestrator only. Provider-specific URL/headers/body/normalize
 * live in `./embeddingProviders/{id}.js`.
 */
export async function handleEmbeddingsCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
}: EmbeddingsCoreParams): Promise<EmbeddingsResult> {
  const { provider, model } = modelInfo;

  // Validate input
  const input = body.input;
  if (!input) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: input", undefined);
  }
  if (typeof input !== "string" && !Array.isArray(input)) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      "input must be a string or array of strings",
      undefined,
    );
  }

  const adapter = getEmbeddingAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support embeddings.`,
      undefined,
    );
  }

  const ctx = { input };
  const url = adapter.buildUrl(model, credentials, ctx);
  const headers = adapter.buildHeaders(credentials, ctx);
  const requestBody = adapter.buildBody(model, {
    input,
    encoding_format: body.encoding_format || "float",
    dimensions: body.dimensions,
  });

  log?.debug?.(
    "EMBEDDINGS",
    `${provider.toUpperCase()} | ${model} | input_type=${Array.isArray(input) ? `array[${input.length}]` : "string"}`,
  );

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (error: unknown) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("EMBEDDINGS", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg, undefined);
  }

  // Handle 401/403 — try token refresh (skip for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      async () => {
        const refreshed = await executor.refreshCredentials(
          (credentials ?? {}) as ExecutorCredentials,
          log,
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
      log,
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for embeddings`);
      if (credentials) Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryHeaders = adapter.buildHeaders(credentials, ctx);
        const retryUrl = adapter.buildUrl(model, credentials, ctx);
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: JSON.stringify(requestBody),
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
    log?.debug?.("EMBEDDINGS", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg, undefined);
  }

  let responseBody;
  try {
    responseBody = await providerResponse.json();
  } catch {
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      `Invalid JSON response from ${provider}`,
      undefined,
    );
  }

  if (onRequestSuccess) await onRequestSuccess();

  const normalized = adapter.normalize(responseBody, model);
  log?.debug?.("EMBEDDINGS", `Success | usage=${JSON.stringify(normalized.usage || {})}`);

  return {
    success: true,
    response: new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
