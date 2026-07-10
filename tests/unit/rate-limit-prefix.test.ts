import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getRateLimitKeyPrefix — RATELIMIT_KEY_PREFIX env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RATELIMIT_KEY_PREFIX;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('returns "" when RATELIMIT_KEY_PREFIX is unset', async () => {
    const { getRateLimitKeyPrefix } = await import("@/lib/rateLimit/redis");
    expect(getRateLimitKeyPrefix()).toBe("");
  });

  it('returns "canary:" when RATELIMIT_KEY_PREFIX is set to "canary:"', async () => {
    process.env.RATELIMIT_KEY_PREFIX = "canary:";
    const { getRateLimitKeyPrefix } = await import("@/lib/rateLimit/redis");
    expect(getRateLimitKeyPrefix()).toBe("canary:");
  });

  it('returns "prod:" when RATELIMIT_KEY_PREFIX is set to "prod:"', async () => {
    process.env.RATELIMIT_KEY_PREFIX = "prod:";
    const { getRateLimitKeyPrefix } = await import("@/lib/rateLimit/redis");
    expect(getRateLimitKeyPrefix()).toBe("prod:");
  });
});
