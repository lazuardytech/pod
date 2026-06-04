// Redis-backed rate limiter using Bun.RedisClient native.
// Sliding window RPM via Sorted Set, concurrent via INCR/DECR.

import crypto from "node:crypto";

const RPM_KEY_PREFIX = "ratelimit:rpm:";
const CONC_KEY_PREFIX = "ratelimit:conc:";
const WINDOW_MS = 60000;
const CLEANUP_TTL = 120;
const CONC_SAFETY_TTL = 60;

export class RedisBackend {
  constructor(url) {
    this.url = url;
    this.client = null;
    this.connected = false;
  }

  async connect() {
    this.client = new Bun.RedisClient();
    // Bun.RedisClient.connect() with REDIS_URL
    // The client reads REDIS_URL from env, but we need to pass it explicitly.
    // Try: set env var temporarily or use the connect method if it accepts a URL

    // Bun.RedisClient constructor with url
    // From Bun docs: client connects using environment variable, or we can
    // call connect(url)
    try {
      await this.client.connect(this.url);
      await this.client.ping();
      this.connected = true;
    } catch (err) {
      this.connected = false;
      // Explicitly disconnect to release the TCP socket
      try {
        await this.client.close();
      } catch {}
      throw err;
    }
  }

  async close() {
    if (this.client && this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  /**
   * Acquire RPM permit using sliding window via Sorted Set.
   * Returns { ok: false, retryAfterSeconds } or { ok: true }.
   */
  async acquireRpm(keyId, maxRpm) {
    if (!this.connected) return { ok: false, retryAfterSeconds: 1 };

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
      console.warn("[RateLimit] Redis RPM error:", err?.message || err);
      return { ok: false, retryAfterSeconds: 1, type: "error" };
    }
  }

  /**
   * Release an RPM slot (called when concurrent check fails after RPM passes).
   * Removes the most-recently-added entry using the unique requestId.
   */
  async releaseRpm(keyId, requestId) {
    if (!this.connected) return;
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
   * Returns { ok: true, release: fn } or { ok: false, retryAfterSeconds: 1 }.
   */
  async acquireConc(keyId, maxConc) {
    if (!this.connected) return { ok: false, retryAfterSeconds: 1 };

    const key = CONC_KEY_PREFIX + keyId;

    try {
      const count = await this.client.incr(key);
      // Safety TTL — auto-clear if process crashes before DECR
      await this.client.expire(key, CONC_SAFETY_TTL);

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
            await this.client.decr(key);
          } catch {
            // Best effort
          }
        },
        type: "concurrent",
      };
    } catch (err) {
      console.warn("[RateLimit] Redis concurrent error:", err?.message || err);
      return { ok: false, retryAfterSeconds: 1, type: "error" };
    }
  }
}
