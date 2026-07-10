// Redis-backed rate limiter using Bun.RedisClient native.
// Sliding window RPM via Sorted Set, concurrent via INCR/DECR.

import crypto from "node:crypto";

const RPM_KEY_PREFIX = "ratelimit:rpm:";
const CONC_KEY_PREFIX = "ratelimit:conc:";
const WINDOW_MS = 60000;
const CLEANUP_TTL = 120;
const CONC_SAFETY_TTL = 60;

export type RpmResult =
  | { ok: true; member: string }
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
      await this.client.connect();
      await this.client.ping();
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
      await this.client.close();
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
      await this.client.zremrangebyscore(key, 0, windowStart);
      const count = await this.client.zcard(key);
      // TTL for cleanup
      await this.client.expire(key, CLEANUP_TTL);

      if (count >= maxRpm) {
        // Get the oldest entry for retry-after calculation
        const oldest = await this.client.zrange(key, 0, 0);
        const oldestTs = oldest && oldest.length > 0 ? Number(oldest[0]) : now;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + WINDOW_MS - now) / 1000));
        return { ok: false, retryAfterSeconds, type: "rpm" };
      }

      // Only add entry when within limit — use unique member ID to avoid
      // collision when two requests arrive in the same millisecond
      const member = `${String(now)}:${crypto.randomUUID().slice(0, 8)}`;
      await this.client.zadd(key, now, member);
      return { ok: true, member };
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
        await this.client.zrem(key, requestId);
      } else {
        // Fallback: remove newest entry
        await this.client.zpopmax(key, 1);
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
      const count = await this.client.incr(key);

      // If EXPIRE fails after INCR succeeded, DECR to undo the leak
      try {
        await this.client.expire(key, CONC_SAFETY_TTL);
      } catch {
        await this.client.decr(key).catch(() => {});
        return { ok: false, retryAfterSeconds: 1, type: "error" };
      }

      if (count > maxConc) {
        await this.client.decr(key);
        return { ok: false, retryAfterSeconds: 1, type: "concurrent" };
      }

      let released = false;
      return {
        ok: true,
        release: async () => {
          if (released) return;
          released = true;
          try {
            await this.client?.decr(key);
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
