// Public API for rate limiting — Redis-backed when REDIS_URL is set, in-memory fallback.
// Replaces previous @/app/api/v1/_utils/apiKeyRateLimit.js

import { initRateLimit, getBackend } from "./backend.js";
import { getApiKeyByKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth.js";

export { initRateLimit };

// ======== Response helpers (shared across backends) ========

function rateLimitResponse(reason, retryAfterSeconds) {
  const message =
    reason === "concurrent"
      ? "Too many concurrent requests for this API key"
      : "Request rate limit exceeded for this API key";

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Retry-After": String(retryAfterSeconds || 1),
  };

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

function wrapStreamingResponse(response, release) {
  const sourceBody = response.body;
  if (!sourceBody) {
    release();
    return response;
  }

  let reader = null;
  const safeRelease = (() => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      release();
    };
  })();

  const wrappedBody = new ReadableStream({
    start(controller) {
      reader = sourceBody.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              safeRelease();
              controller.close();
              return;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          safeRelease();
          controller.error(error);
        }
      };
      pump();
    },
    async cancel(reason) {
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

function finalizeResponse(response, release) {
  if (!release) return response;
  if (!(response instanceof Response)) {
    release();
    return response;
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const isStreaming =
    contentType.includes("text/event-stream") ||
    contentType.includes("application/x-ndjson") ||
    contentType.includes("application/ndjson");
  if (!isStreaming) {
    release();
    return response;
  }
  return wrapStreamingResponse(response, release);
}

// ======== Public API ========

/**
 * Standalone rate limit check for routes that already handle auth themselves.
 */
export async function checkRateLimitByKey(apiKey) {
  if (!apiKey) return { ok: true, release: null, response: undefined };
  const apiKeyRecord = await getApiKeyByKey(apiKey).catch(() => null);
  if (!apiKeyRecord) return { ok: true, release: null, response: undefined };

  const backend = await getBackend();

  // Duck-type: RedisBackend has acquireRpm, MemoryBackend doesn't
  if (backend.acquireRpm) {
    const config = getLimitConfigFromRecord(apiKeyRecord);
    if (!config) return { ok: true, release: null, response: undefined };

    const rpmResult = await backend.acquireRpm(apiKeyRecord.id, config.requestsPerMinute);
    if (!rpmResult.ok) {
      return {
        ok: false,
        release: null,
        response: rateLimitResponse(rpmResult.type || "rpm", rpmResult.retryAfterSeconds),
      };
    }

    const concResult = await backend.acquireConc(apiKeyRecord.id, config.concurrentRequests);
    if (!concResult.ok) {
      // Release RPM slot — consumed but we can't proceed due to concurrent limit
      try {
        await backend.releaseRpm?.(apiKeyRecord.id, rpmResult.member);
      } catch {}
      return { ok: false, release: null, response: rateLimitResponse(concResult.type || "concurrent", 1) };
    }

    return { ok: true, release: concResult.release, response: undefined };
  }

  // MemoryBackend path
  const permit = backend.acquirePermit(apiKeyRecord);
  if (!permit.ok) {
    return { ok: false, release: null, response: rateLimitResponse(permit.reason, permit.retryAfterSeconds) };
  }
  return { ok: true, release: permit.release, response: undefined };
}

function getLimitConfigFromRecord(apiKeyRecord) {
  if (!apiKeyRecord || apiKeyRecord.limitType !== "limited") return null;
  const toPositiveInt = (v) => {
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
 * Uses backend.acquireRpm + backend.acquireConc for Redis, or backend.acquirePermit for memory.
 */
export async function withApiKeyRateLimit(request, handler) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return await handler();

  const apiKeyRecord = await getApiKeyByKey(apiKey).catch(() => null);
  if (!apiKeyRecord) return await handler();

  const backend = await getBackend();

  // Duck-type: RedisBackend has acquireRpm, MemoryBackend doesn't
  if (backend.acquireRpm) {
    const config = getLimitConfigFromRecord(apiKeyRecord);
    if (!config) return await handler();

    const rpmResult = await backend.acquireRpm(apiKeyRecord.id, config.requestsPerMinute);
    if (!rpmResult.ok) {
      return rateLimitResponse(rpmResult.type || "rpm", rpmResult.retryAfterSeconds);
    }

    const concResult = await backend.acquireConc(apiKeyRecord.id, config.concurrentRequests);
    if (!concResult.ok) {
      // Release RPM slot — consumed but we can't proceed due to concurrent limit
      try {
        await backend.releaseRpm?.(apiKeyRecord.id, rpmResult.member);
      } catch {}
      return rateLimitResponse(concResult.type || "concurrent", 1);
    }

    let release = concResult.release;
    try {
      const response = await handler();
      const finalResponse = finalizeResponse(response, release);
      release = null;
      return finalResponse;
    } catch (error) {
      if (release) release?.();
      throw error;
    }
  }

  // MemoryBackend path
  const permit = backend.acquirePermit(apiKeyRecord);
  if (!permit.ok) return rateLimitResponse(permit.reason, permit.retryAfterSeconds);

  let release = permit.release;
  try {
    const response = await handler();
    const finalResponse = finalizeResponse(response, release);
    release = null;
    return finalResponse;
  } catch (error) {
    if (release) release();
    throw error;
  }
}
