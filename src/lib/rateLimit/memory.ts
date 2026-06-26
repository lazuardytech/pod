// In-memory rate limiter — extracted from original apiKeyRateLimit.js
// Falls back to this when Redis is unavailable.

const minuteCounters = new Map<string, { windowStart: number; count: number; updatedAt: number }>();
const concurrentCounters = new Map<string, { count: number; lastAccess: number }>();
const COUNTER_TTL_MS = 120000;
let lastConcurrentTrim = Date.now();
const CONCURRENT_TRIM_INTERVAL_MS = 60000;

function trimConcurrentCounters(nowMs: number): void {
  if (nowMs - lastConcurrentTrim < CONCURRENT_TRIM_INTERVAL_MS) return;
  lastConcurrentTrim = nowMs;
  for (const [keyId, entry] of concurrentCounters.entries()) {
    if (nowMs - entry.lastAccess > COUNTER_TTL_MS) {
      concurrentCounters.delete(keyId);
    }
  }
}

function toPositiveInt(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return null;
  return num;
}

export type LimitConfig = { requestsPerMinute: number; concurrentRequests: number };

export type ApiKeyRecord = { id: string; limitType?: string; requestsPerMinute?: number; concurrentRequests?: number };

export type PermitResult =
  | { ok: true; release: (() => void) | null }
  | { ok: false; reason: "rpm" | "concurrent"; retryAfterSeconds: number };

export class MemoryBackend {
  constructor() {}

  async connect(): Promise<void> {
    // No-op: in-memory is always ready
  }

  async close(): Promise<void> {
    minuteCounters.clear();
    concurrentCounters.clear();
  }

  getLimitConfig(apiKeyRecord: ApiKeyRecord | null | undefined): LimitConfig | null {
    if (!apiKeyRecord || apiKeyRecord.limitType !== "limited") return null;
    const requestsPerMinute = toPositiveInt(apiKeyRecord.requestsPerMinute);
    const concurrentRequests = toPositiveInt(apiKeyRecord.concurrentRequests);
    if (!requestsPerMinute || !concurrentRequests) return null;
    return { requestsPerMinute, concurrentRequests };
  }

  maybeTrimCounterMaps(nowMs: number): void {
    // Periodic time-based trim for all entries beyond TTL (not just when >10k)
    const expired: string[] = [];
    for (const [keyId, entry] of minuteCounters.entries()) {
      if (nowMs - entry.updatedAt > COUNTER_TTL_MS) {
        expired.push(keyId);
      }
    }
    for (const keyId of expired) {
      minuteCounters.delete(keyId);
    }
  }

  acquirePermit(apiKeyRecord: ApiKeyRecord): PermitResult {
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
