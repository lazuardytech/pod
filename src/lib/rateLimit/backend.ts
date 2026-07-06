// Backend abstraction for rate limiting — picks Redis or in-memory based on REDIS_URL
// Zero npm dependency: uses Bun.RedisClient native when Redis is available

import type { MemoryBackend } from "./memory";
import type { RedisBackend } from "./redis";

let _backend: RedisBackend | MemoryBackend | null = null;
let _initialized = false;

/**
 * Initialize rate limit backend.
 * Called once at startup from initializeApp.ts.
 * Connects to Redis if REDIS_URL is set; falls back to in-memory.
 */
export async function initRateLimit(): Promise<RedisBackend | MemoryBackend> {
  if (_initialized) return _backend as RedisBackend | MemoryBackend;
  _initialized = true;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const { RedisBackend } = await import("./redis");
      _backend = new RedisBackend(redisUrl);
      await _backend.connect();
      console.log("[RateLimit] Redis backend active");
      return _backend;
    } catch (err) {
      console.warn(
        "[RateLimit] Redis connect failed, falling back to in-memory:",
        (err as Error)?.message || err,
      );
    }
  }

  const { MemoryBackend } = await import("./memory");
  _backend = new MemoryBackend();
  console.log("[RateLimit] In-memory backend active");
  return _backend;
}

/**
 * Get the initialized backend instance.
 * Returns in-memory backend if initRateLimit was not called yet (lazy init).
 */
export async function getBackend(): Promise<RedisBackend | MemoryBackend> {
  if (!_initialized) {
    return await initRateLimit();
  }
  return _backend as RedisBackend | MemoryBackend;
}
