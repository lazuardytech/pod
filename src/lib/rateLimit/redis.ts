// Redis-backed rate limiter using Bun.RedisClient native.
// Sliding window RPM via Sorted Set, concurrent via INCR/DECR.

import crypto from "node:crypto";

const KEY_PREFIX = process.env.RATELIMIT_KEY_PREFIX ?? "";
const RPM_KEY_PREFIX = `${KEY_PREFIX}ratelimit:rpm:`;
const CONC_KEY_PREFIX = `${KEY_PREFIX}ratelimit:conc:`;

/**
 * Exported for testability. Resolves the effective Redis key prefix from
 * the `RATELIMIT_KEY_PREFIX` env var (defaults to empty string).
 */
export function getRateLimitKeyPrefix(): string {
  return process.env.RATELIMIT_KEY_PREFIX ?? "";
}
const WINDOW_MS = 60000;
const CLEANUP_TTL = 120;
const CONC_SAFETY_TTL = 60;
const REDIS_OP_TIMEOUT_MS = Number.parseInt(process.env.RATELIMIT_REDIS_TIMEOUT_MS ?? "1000", 10);

function withTimeout<T>(p: Promise<T>, opName: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`redis:${opName} timeout after ${REDIS_OP_TIMEOUT_MS}ms`)),
        REDIS_OP_TIMEOUT_MS,
      ),
    ),
  ]);
}

export type RpmResult =
  | { ok: true; member: string; remaining: number; resetSeconds: number }
  | { ok: false; retryAfterSeconds: number; type: "rpm" | "concurrent" | "error" };

export type ConcResult =
  | { ok: true; release: () => Promise<void>; type: "concurrent" }
  | { ok: false; retryAfterSeconds: number; type: "rpm" | "concurrent" | "error" };

export class RedisBackend {
  url: string;
  client: Bun.RedisClient | null = null;
  connected: boolean = false;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    this.client = new Bun.RedisClient(this.url);
    try {
      await withTimeout(this.client.connect(), "connect");
      await withTimeout(this.client.ping(), "ping");
      this.connected = true;
    } catch (err) {
      this.connected = false;
      // Explicitly disconnect to release the TCP socket
      try {
        this.client.close();
      } catch {}
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.client && this.connected) {
      this.client.close();
      this.connected = false;
    }
  }

  /**
   * Acquire RPM permit using sliding window via Sorted Set.
   */
  async acquireRpm(keyId: string, maxRpm: number): Promise<RpmResult> {
    if (!this.connected || !this.client) return { ok: false, retryAfterSeconds: 1, type: "error" };

    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const key = RPM_KEY_PREFIX + keyId;

    try {
      // Remove expired entries, then check count BEFORE adding
      await withTimeout(this.client.zremrangebyscore(key, 0, windowStart), "zremrangebyscore");
      const count = await withTimeout(this.client.zcard(key), "zcard");
      // TTL for cleanup
      await withTimeout(this.client.expire(key, CLEANUP_TTL), "expire");

      if (count >= maxRpm) {
        // Get the oldest entry for retry-after calculation
        const oldest = await withTimeout(this.client.zrange(key, 0, 0), "zrange");
        const oldestTs = oldest && oldest.length > 0 ? Number(oldest[0]) : now;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + WINDOW_MS - now) / 1000));
        return { ok: false, retryAfterSeconds, type: "rpm" };
      }

      // Only add entry when within limit — use unique member ID to avoid
      // collision when two requests arrive in the same millisecond
      const member = `${String(now)}:${crypto.randomUUID().slice(0, 8)}`;
      await withTimeout(this.client.zadd(key, now, member), "zadd");
      const remaining = Math.max(0, maxRpm - count);
      const oldest = await withTimeout(this.client.zrange(key, 0, 0), "zrange");
      const oldestTs = oldest && oldest.length > 0 ? Number(oldest[0]) : now;
      const resetSeconds = Math.max(1, Math.ceil((oldestTs + WINDOW_MS - now) / 1000));
      return { ok: true, member, remaining, resetSeconds };
    } catch (err) {
      console.warn("[RateLimit] Redis RPM error:", (err as Error)?.message || err);
      return { ok: false, retryAfterSeconds: 1, type: "error" };
    }
  }

  /**
   * Release an RPM slot (called when concurrent check fails after RPM passes).
   */
  async releaseRpm(keyId: string, requestId: string | undefined): Promise<void> {
    if (!this.connected || !this.client) return;
    const key = RPM_KEY_PREFIX + keyId;
    try {
      if (requestId) {
        await withTimeout(this.client.zrem(key, requestId), "zrem");
      } else {
        // Fallback: remove newest entry
        await withTimeout(this.client.zpopmax(key, 1), "zpopmax");
      }
    } catch {
      // Best effort
    }
  }

  /**
   * Acquire concurrent request permit via INCR/DECR.
   */
  async acquireConc(keyId: string, maxConc: number): Promise<ConcResult> {
    if (!this.connected || !this.client) return { ok: false, retryAfterSeconds: 1, type: "error" };

    const key = CONC_KEY_PREFIX + keyId;

    try {
      const count = await withTimeout(this.client.incr(key), "incr");

      // If EXPIRE fails after INCR succeeded, DECR to undo the leak
      try {
        await withTimeout(this.client.expire(key, CONC_SAFETY_TTL), "expire");
      } catch {
        await withTimeout(this.client.decr(key), "decr").catch(() => {});
        return { ok: false, retryAfterSeconds: 1, type: "error" };
      }

      if (count > maxConc) {
        await withTimeout(this.client.decr(key), "decr");
        return { ok: false, retryAfterSeconds: 1, type: "concurrent" };
      }

      let released = false;
      return {
        ok: true,
        release: async () => {
          if (released) return;
          released = true;
          try {
            if (!this.client) return;
            await withTimeout(this.client.decr(key), "decr");
          } catch {
            // Best effort
          }
        },
        type: "concurrent",
      };
    } catch (err) {
      console.warn("[RateLimit] Redis concurrent error:", (err as Error)?.message || err);
      return { ok: false, retryAfterSeconds: 1, type: "error" };
    }
  }
}
