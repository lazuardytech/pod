/**
 * NOTE: Rate limiting state is in-memory and per-process.
 * In a multi-process deployment (cluster, PM2, multiple replicas),
 * limits are NOT enforced globally — each process has independent counters.
 * For cluster deployments, migrate to a shared store (e.g. Redis).
 */
import { getApiKeyByKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth.js";

const minuteCounters = new Map();
const concurrentCounters = new Map();
const COUNTER_TTL_MS = 120000;
const MAX_TRACKED_KEYS = 10000;

function toPositiveInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

function getLimitConfig(apiKeyRecord) {
  if (!apiKeyRecord || apiKeyRecord.limitType !== "limited") return null;
  const requestsPerMinute = toPositiveInt(apiKeyRecord.requestsPerMinute);
  const concurrentRequests = toPositiveInt(apiKeyRecord.concurrentRequests);
  if (!requestsPerMinute || !concurrentRequests) return null;
  return { requestsPerMinute, concurrentRequests };
}

function maybeTrimCounterMaps(nowMs) {
  if (minuteCounters.size <= MAX_TRACKED_KEYS) return;
  for (const [keyId, entry] of minuteCounters.entries()) {
    if (nowMs - entry.updatedAt > COUNTER_TTL_MS) minuteCounters.delete(keyId);
  }
}

function acquirePermit(apiKeyRecord) {
  const config = getLimitConfig(apiKeyRecord);
  if (!config) return { ok: true, release: null };

  const keyId = apiKeyRecord.id;
  const nowMs = Date.now();
  maybeTrimCounterMaps(nowMs);

  const bucket = minuteCounters.get(keyId) || {
    windowStart: nowMs,
    count: 0,
    updatedAt: nowMs,
  };

  if (nowMs - bucket.windowStart >= 60000) {
    bucket.windowStart = nowMs;
    bucket.count = 0;
  }

  if (bucket.count >= config.requestsPerMinute) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + 60000 - nowMs) / 1000));
    return { ok: false, reason: "rpm", retryAfterSeconds };
  }

  const currentConcurrent = concurrentCounters.get(keyId) || 0;
  if (currentConcurrent >= config.concurrentRequests) {
    return { ok: false, reason: "concurrent", retryAfterSeconds: 1 };
  }

  bucket.count += 1;
  bucket.updatedAt = nowMs;
  minuteCounters.set(keyId, bucket);
  concurrentCounters.set(keyId, currentConcurrent + 1);

  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const current = concurrentCounters.get(keyId) || 0;
      if (current <= 1) concurrentCounters.delete(keyId);
      else concurrentCounters.set(keyId, current - 1);
    },
  };
}

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

/**
 * Standalone rate limit check for routes that already handle auth themselves.
 * Call after auth succeeds. Returns { ok, response } where response is a 429 Response if limited.
 */
export async function checkRateLimitByKey(apiKey) {
  if (!apiKey) return { ok: true, release: null, response: undefined };
  const apiKeyRecord = await getApiKeyByKey(apiKey).catch(() => null);
  if (!apiKeyRecord) return { ok: true, release: null, response: undefined };
  const permit = acquirePermit(apiKeyRecord);
  if (!permit.ok) {
    return { ok: false, release: null, response: rateLimitResponse(permit.reason, permit.retryAfterSeconds) };
  }
  return { ok: true, release: permit.release, response: undefined };
}

export async function withApiKeyRateLimit(request, handler) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return await handler();

  const apiKeyRecord = await getApiKeyByKey(apiKey).catch(() => null);
  if (!apiKeyRecord) return await handler();

  const permit = acquirePermit(apiKeyRecord);
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
