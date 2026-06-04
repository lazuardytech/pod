// In-memory rate limiter — extracted from original apiKeyRateLimit.js
// Falls back to this when Redis is unavailable.

const minuteCounters = new Map();
const concurrentCounters = new Map();
const COUNTER_TTL_MS = 120000;
let lastConcurrentTrim = Date.now();
const CONCURRENT_TRIM_INTERVAL_MS = 60000;

function trimConcurrentCounters(nowMs) {
  if (nowMs - lastConcurrentTrim < CONCURRENT_TRIM_INTERVAL_MS) return;
  lastConcurrentTrim = nowMs;
  for (const [keyId, entry] of concurrentCounters.entries()) {
    if (nowMs - entry.lastAccess > COUNTER_TTL_MS) {
      concurrentCounters.delete(keyId);
    }
  }
}

function toPositiveInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

export class MemoryBackend {
  constructor() {}

  async connect() {
    // No-op: in-memory is always ready
  }

  async close() {
    minuteCounters.clear();
    concurrentCounters.clear();
  }

  getLimitConfig(apiKeyRecord) {
    if (!apiKeyRecord || apiKeyRecord.limitType !== "limited") return null;
    const requestsPerMinute = toPositiveInt(apiKeyRecord.requestsPerMinute);
    const concurrentRequests = toPositiveInt(apiKeyRecord.concurrentRequests);
    if (!requestsPerMinute || !concurrentRequests) return null;
    return { requestsPerMinute, concurrentRequests };
  }

  maybeTrimCounterMaps(nowMs) {
    // Periodic time-based trim for all entries beyond TTL (not just when >10k)
    const expired = [];
    for (const [keyId, entry] of minuteCounters.entries()) {
      if (nowMs - entry.updatedAt > COUNTER_TTL_MS) {
        expired.push(keyId);
      }
    }
    for (const keyId of expired) {
      minuteCounters.delete(keyId);
    }
  }

  acquirePermit(apiKeyRecord) {
    const config = this.getLimitConfig(apiKeyRecord);
    if (!config) return { ok: true, release: null };

    const keyId = apiKeyRecord.id;
    const nowMs = Date.now();
    this.maybeTrimCounterMaps(nowMs);
    trimConcurrentCounters(nowMs);

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

    const concEntry = concurrentCounters.get(keyId) || { count: 0, lastAccess: nowMs };
    if (concEntry.count >= config.concurrentRequests) {
      concEntry.lastAccess = nowMs;
      concurrentCounters.set(keyId, concEntry);
      return { ok: false, reason: "concurrent", retryAfterSeconds: 1 };
    }

    bucket.count += 1;
    bucket.updatedAt = nowMs;
    minuteCounters.set(keyId, bucket);
    concEntry.count += 1;
    concEntry.lastAccess = nowMs;
    concurrentCounters.set(keyId, concEntry);

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        const current = concurrentCounters.get(keyId);
        if (current) {
          current.count -= 1;
          current.lastAccess = nowMs;
          if (current.count <= 0) concurrentCounters.delete(keyId);
          else concurrentCounters.set(keyId, current);
        }
      },
    };
  }
}
