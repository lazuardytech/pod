import { DEFAULT_ERROR_MESSAGES, ERROR_TYPES } from "../config/errorConfig.ts";

type ErrorTypeInfo = { type: string; code: string };

const ERROR_TYPES_MAP = ERROR_TYPES as Record<number, ErrorTypeInfo>;
const DEFAULT_ERROR_MESSAGES_MAP = DEFAULT_ERROR_MESSAGES as Record<number, string>;

export type ErrorResult = {
  success: false;
  status: number;
  error: string;
  resetsAtMs?: number | null;
  response: Response;
};

type UpstreamParseResult = {
  message?: string;
  status?: number;
  resetsAtMs?: number;
};

type UpstreamErrorExecutor = {
  parseError?: (response: Response, bodyText: string) => UpstreamParseResult | null | undefined;
} | null;

type StreamWriter = {
  write: (chunk: Uint8Array) => PromiseLike<unknown>;
};

/**
 * Shared Access-Control-Expose-Headers value for rate-limit headers.
 * Defined once here to prevent drift across error.js and rateLimit/index.ts.
 */
export const RATE_LIMIT_EXPOSE_HEADERS =
  "Retry-After, x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode: number, message?: string | null) {
  const errorInfo =
    ERROR_TYPES_MAP[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES_MAP[statusCode] || "An error occurred",
      type: errorInfo.type,
      param: null,
      code: errorInfo.code,
    },
  };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode: number, message?: string | null) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": RATE_LIMIT_EXPOSE_HEADERS,
    },
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(
  writer: StreamWriter,
  statusCode: number,
  message?: string | null,
) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(
  response: Response,
  executor: UpstreamErrorExecutor = null,
) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg =
          parsed.message ||
          DEFAULT_ERROR_MESSAGES_MAP[response.status] ||
          `Upstream error: ${response.status}`;
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          resetsAtMs: parsed.resetsAtMs,
        };
      }
    } catch {
      /* fall through to default parsing */
    }
  }

  let message: unknown = "";
  try {
    const json = JSON.parse(bodyText) as {
      error?: { message?: string } | string;
      message?: string;
    };
    message =
      (typeof json.error === "object" && json.error !== null ? json.error.message : undefined) ||
      json.message ||
      json.error ||
      bodyText;
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage =
    messageStr ||
    DEFAULT_ERROR_MESSAGES_MAP[response.status] ||
    `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(
  statusCode: number,
  message: string,
  resetsAtMs?: number | null,
): ErrorResult {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message),
  } as ErrorResult;
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(
  statusCode: number,
  message: string,
  retryAfter: string,
  retryAfterHuman: string,
) {
  const retryAfterSec = Math.max(
    Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000),
    1,
  );
  const msg = `${message} (${retryAfterHuman})`;
  const errorInfo =
    ERROR_TYPES_MAP[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "unavailable" });

  return new Response(
    JSON.stringify({
      error: { message: msg, type: errorInfo.type, param: null, code: errorInfo.code },
    }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(
  error: unknown,
  provider: unknown,
  model: unknown,
  statusCode: unknown,
) {
  void provider;
  void model;
  const record = errorRecord(error);
  const code = statusCode || record.code || "FETCH_FAILED";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const cause = errorRecord(record.cause);
  const causeCode = cause.code;
  const causeMsg = cause.message;
  const causeStr =
    causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
