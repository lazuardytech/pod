// Public API for rate limiting — Redis-backed when REDIS_URL is set, in-memory fallback.
// Replaces previous @/app/api/v1/_utils/apiKeyRateLimit.js

import { getApiKeyByKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth";
import { getBackend, initRateLimit } from "./backend";
import { RATE_LIMIT_EXPOSE_HEADERS } from "open-sse/utils/error.js";

export { initRateLimit };

// ======== Response helpers (shared across backends) ========

function rateLimitResponse(
  reason: string,
  retryAfterSeconds: number | undefined,
  limit?: number,
  remaining?: number,
  reset?: number,
): Response {
  const message =
    reason === "concurrent"
      ? "Too many concurrent requests for this API key"
      : "Request rate limit exceeded for this API key";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Retry-After": String(retryAfterSeconds || 1),
  };

  if (limit !== undefined) {
    headers["x-ratelimit-limit-requests"] = String(limit);
    headers["x-ratelimit-remaining-requests"] = String(remaining ?? 0);
    headers["x-ratelimit-reset-requests"] = String(reset ?? retryAfterSeconds ?? 1);
    headers["Access-Control-Expose-Headers"] = RATE_LIMIT_EXPOSE_HEADERS;
  }

  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "rate_limit_error",
        code: reason === "concurrent" ? "concurrent_limit_exceeded" : "rate_limit_exceeded",
      },
    }),
    { status: 429, headers },
  );
}

export function attachRateLimitHeaders(
  res: Response,
  info: { limit: number; remaining: number; reset: number },
): Response {
  if (!(res instanceof Response)) return res;
  res.headers.set("x-ratelimit-limit-requests", String(info.limit));
  res.headers.set("x-ratelimit-remaining-requests", String(info.remaining));
  res.headers.set("x-ratelimit-reset-requests", String(info.reset));
  res.headers.set("Access-Control-Expose-Headers", RATE_LIMIT_EXPOSE_HEADERS);
  return res;
}

function wrapStreamingResponse(response: Response, release: () => void | Promise<void>): Response {
  const sourceBody = response.body;
  if (!sourceBody) {
    void release();
    return response;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const safeRelease = ((): any => {
    let done = false;
    return (): void => {
      if (done) return;
      done = true;
      void release();
    };
  })();

  const wrappedBody = new ReadableStream<Uint8Array>({
    start(controller): any {
      reader = sourceBody.getReader();
      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader!.read();
            if (done) {
              safeRelease();
              controller.close();
              return;
            }
            if (value) controller.enqueue(value);
          }
        } catch (error) {
          safeRelease();
          controller.error(error);
        }
      };
      void pump();
    },
    async cancel(reason): Promise<any> {
      safeRelease();
      if (reader) {
        try {
          await reader.cancel(reason);
        } catch {}
      }
    },
  });

  return new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

function finalizeResponse(
  response: Response | unknown,
  release: (() => void | Promise<void>) | null,
): Response | unknown {
  if (!release) return response;
  if (!(response instanceof Response)) {
    void release();
    return response;
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const isStreaming =
    contentType.includes("text/event-stream") ||
    contentType.includes("application/x-ndjson") ||
    contentType.includes("application/ndjson");
  if (!isStreaming) {
    void release();
    return response;
  }
  return wrapStreamingResponse(response, release);
}

// ======== Public API ========

type RateLimitCheckResult =
  | { ok: true; release: (() => void) | null; response: undefined }
  | { ok: false; release: null; response: Response };

/**
 * Standalone rate limit check for routes that already handle auth themselves.
 */
export async function checkRateLimitByKey(
  apiKey: string | null | undefined,
): Promise<RateLimitCheckResult> {
  if (!apiKey) return { ok: true, release: null, response: undefined };
  const apiKeyRecord = await getApiKeyByKey(apiKey).catch((): any => null);
  if (!apiKeyRecord) return { ok: true, release: null, response: undefined };

  const backend = await getBackend();

  // Duck-type: RedisBackend has acquireRpm, MemoryBackend doesn't
  type RedisLike = {
    acquireRpm: (
      keyId: string,
      max: number,
    ) => Promise<{
      ok: boolean;
      member?: string;
      type?: string;
      retryAfterSeconds?: number;
      remaining?: number;
      resetSeconds?: number;
    }>;
    acquireConc: (
      keyId: string,
      max: number,
    ) => Promise<{
      ok: boolean;
      release?: () => Promise<void>;
      type?: string;
      retryAfterSeconds?: number;
    }>;
    releaseRpm?: (keyId: string, member: string | undefined) => Promise<void>;
  };
  const redisBackend = backend as unknown as Partial<RedisLike>;
  if (redisBackend.acquireRpm) {
    const config = getLimitConfigFromRecord(apiKeyRecord);
    if (!config) return { ok: true, release: null, response: undefined };

    const rpmResult = await redisBackend.acquireRpm(apiKeyRecord.id, config.requestsPerMinute);
    if (!rpmResult.ok) {
      return {
        ok: false,
        release: null,
        response: rateLimitResponse(rpmResult.type || "rpm", rpmResult.retryAfterSeconds),
      };
    }

    if (!redisBackend.acquireConc) {
      return { ok: true, release: null, response: undefined };
    }
    const concResult = await redisBackend.acquireConc(apiKeyRecord.id, config.concurrentRequests);
    if (!concResult.ok) {
      // Release RPM slot — consumed but we can't proceed due to concurrent limit
      try {
        await redisBackend.releaseRpm?.(apiKeyRecord.id, rpmResult.member);
      } catch {}
      return {
        ok: false,
        release: null,
        response: rateLimitResponse(concResult.type || "concurrent", 1),
      };
    }

    return {
      ok: true,
      release: concResult.release ? (): any => void concResult.release?.() : null,
      response: undefined,
    };
  }

  // MemoryBackend path
  type MemoryLike = {
    acquirePermit: (record: {
      id: string;
      limitType?: string;
      requestsPerMinute?: number;
      concurrentRequests?: number;
    }) => {
      ok: boolean;
      reason?: string;
      retryAfterSeconds?: number;
      release?: (() => void) | null;
    };
  };
  const memBackend = backend as unknown as MemoryLike;
  const permit = memBackend.acquirePermit(apiKeyRecord);
  if (!permit.ok) {
    return {
      ok: false,
      release: null,
      response: rateLimitResponse(permit.reason || "rpm", permit.retryAfterSeconds),
    };
  }
  return { ok: true, release: permit.release ?? null, response: undefined };
}

function getLimitConfigFromRecord(
  apiKeyRecord: {
    limitType?: string;
    requestsPerMinute?: number;
    concurrentRequests?: number;
  } | null,
): { requestsPerMinute: number; concurrentRequests: number } | null {
  if (!apiKeyRecord || apiKeyRecord.limitType !== "limited") return null;
  const toPositiveInt = (v: unknown): number | null => {
    const num = Number(v);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
    return num;
  };
  const requestsPerMinute = toPositiveInt(apiKeyRecord.requestsPerMinute);
  const concurrentRequests = toPositiveInt(apiKeyRecord.concurrentRequests);
  if (!requestsPerMinute || !concurrentRequests) return null;
  return { requestsPerMinute, concurrentRequests };
}

/**
 * Wraps an API handler with rate limit enforcement.
 */
export async function withApiKeyRateLimit(
  request: Request,
  handler: () => Promise<unknown>,
): Promise<unknown> {
  const apiKey = extractApiKey(request);
  if (!apiKey) return await handler();

  const apiKeyRecord = await getApiKeyByKey(apiKey).catch((): any => null);
  if (!apiKeyRecord) return await handler();

  const backend = await getBackend();

  type RedisLike = {
    acquireRpm: (
      keyId: string,
      max: number,
    ) => Promise<{
      ok: boolean;
      member?: string;
      type?: string;
      retryAfterSeconds?: number;
      remaining?: number;
      resetSeconds?: number;
    }>;
    acquireConc: (
      keyId: string,
      max: number,
    ) => Promise<{
      ok: boolean;
      release?: () => Promise<void>;
      type?: string;
      retryAfterSeconds?: number;
    }>;
    releaseRpm?: (keyId: string, member: string | undefined) => Promise<void>;
  };
  const redisBackend = backend as unknown as Partial<RedisLike>;
  if (redisBackend.acquireRpm) {
    const config = getLimitConfigFromRecord(apiKeyRecord);
    if (!config) return await handler();

    const rpmResult = await redisBackend.acquireRpm(apiKeyRecord.id, config.requestsPerMinute);
    if (!rpmResult.ok) {
      return rateLimitResponse(
        rpmResult.type || "rpm",
        rpmResult.retryAfterSeconds,
        config.requestsPerMinute,
        0,
        rpmResult.retryAfterSeconds,
      );
    }

    if (!redisBackend.acquireConc) {
      return await handler();
    }
    const concResult = await redisBackend.acquireConc(apiKeyRecord.id, config.concurrentRequests);
    if (!concResult.ok) {
      try {
        await redisBackend.releaseRpm?.(apiKeyRecord.id, rpmResult.member);
      } catch {}
      return rateLimitResponse(
        concResult.type || "concurrent",
        1,
        config.requestsPerMinute,
        rpmResult.remaining ?? 0,
        rpmResult.resetSeconds ?? 0,
      );
    }

    let release: (() => void | Promise<void>) | null = concResult.release
      ? () => void (concResult.release as () => void)()
      : null;
    try {
      const response = await handler();
      const finalResponse = finalizeResponse(response, release);
      release = null;
      return attachRateLimitHeaders(finalResponse as Response, {
        limit: config.requestsPerMinute,
        remaining: rpmResult.remaining ?? 0,
        reset: rpmResult.resetSeconds ?? 0,
      });
    } catch (error) {
      if (release) await release();
      throw error;
    }
  }

  // MemoryBackend path
  type MemoryLike = {
    acquirePermit: (record: {
      id: string;
      limitType?: string;
      requestsPerMinute?: number;
      concurrentRequests?: number;
    }) => {
      ok: boolean;
      reason?: string;
      retryAfterSeconds?: number;
      release?: (() => void) | null;
      remaining?: number;
      resetSeconds?: number;
    };
  };
  const memBackend = backend as unknown as MemoryLike;
  const config = getLimitConfigFromRecord(apiKeyRecord) ?? {
    requestsPerMinute: 60,
    concurrentRequests: 5,
  };
  const permit = memBackend.acquirePermit(apiKeyRecord);
  if (!permit.ok)
    return rateLimitResponse(
      permit.reason || "rpm",
      permit.retryAfterSeconds,
      config.requestsPerMinute,
      0,
      permit.retryAfterSeconds,
    );

  let release: (() => void) | null = permit.release ?? null;
  try {
    const response = await handler();
    const finalResponse = finalizeResponse(response, release);
    release = null;
    return attachRateLimitHeaders(finalResponse as Response, {
      limit: config.requestsPerMinute,
      remaining: permit.remaining ?? 0,
      reset: permit.resetSeconds ?? 0,
    });
  } catch (error) {
    if (release) release();
    throw error;
  }
}
