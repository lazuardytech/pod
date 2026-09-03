/**
 * Unit tests for the Redis rate-limit backend (src/lib/rateLimit/redis.ts).
 *
 * The Redis backend is the production path — it is selected whenever
 * REDIS_URL is set (Zeabur deploys an in-project Redis). The backend is
 * exercised through a fake client injected after construction, so no real
 * Redis connection is required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeClient = {
  zremrangebyscore: ReturnType<typeof vi.fn>;
  zcard: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  zrange: ReturnType<typeof vi.fn>;
  zadd: ReturnType<typeof vi.fn>;
  zrem: ReturnType<typeof vi.fn>;
  zpopmax: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  decr: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeFakeClient(): FakeClient {
  return {
    zremrangebyscore: vi.fn(async () => 0),
    zcard: vi.fn(async () => 0),
    expire: vi.fn(async () => 1),
    zrange: vi.fn(async () => []),
    zadd: vi.fn(async () => 1),
    zrem: vi.fn(async () => 1),
    zpopmax: vi.fn(async () => [["0", "0"]]),
    incr: vi.fn(async () => 1),
    decr: vi.fn(async () => 0),
    close: vi.fn(),
  };
}

async function loadBackend(fake: FakeClient) {
  const { RedisBackend } = await import("@/lib/rateLimit/redis");
  const backend = new RedisBackend("redis://localhost:6379");
  backend.client = fake as never;
  backend.connected = true;
  return backend;
}

describe("RedisBackend.acquireRpm", () => {
  it("grants a permit when under the limit and emits cleanup + insert calls", async () => {
    const fake = makeFakeClient();
    fake.zcard.mockResolvedValueOnce(4);
    fake.zrange.mockResolvedValueOnce([String(Date.now() - 30000)]);
    const backend = await loadBackend(fake);

    const result = await backend.acquireRpm("key-1", 5);

    expect(result).toMatchObject({ ok: true, remaining: 1 });
    expect(fake.zremrangebyscore).toHaveBeenCalledWith(
      "ratelimit:rpm:key-1",
      0,
      expect.any(Number),
    );
    expect(fake.expire).toHaveBeenCalledWith("ratelimit:rpm:key-1", 120);
    const [zaddKey, zaddScore, zaddMember] = fake.zadd.mock.calls[0]!;
    expect(zaddKey).toBe("ratelimit:rpm:key-1");
    expect(typeof zaddScore).toBe("number");
    // Unique member: timestamp + random suffix, so same-ms requests don't collide.
    expect(String(zaddMember)).toMatch(/^\d+:[0-9a-f]{8}$/);
    expect(result.ok && result.resetSeconds).toBeGreaterThanOrEqual(1);
  });

  it("denies with retry-after when the window count already equals maxRpm", async () => {
    const fake = makeFakeClient();
    // Oldest window entry 30s in the past -> ~30s until the window rolls over.
    const oldestTs = Date.now() - 30000;
    fake.zcard.mockResolvedValueOnce(5);
    fake.zrange.mockResolvedValueOnce([String(oldestTs)]);
    const backend = await loadBackend(fake);

    const result = await backend.acquireRpm("key-1", 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.type).toBe("rpm");
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(fake.zadd).not.toHaveBeenCalled();
  });

  it("denies when the window count exceeds maxRpm", async () => {
    const fake = makeFakeClient();
    fake.zcard.mockResolvedValueOnce(9);
    fake.zrange.mockResolvedValueOnce([String(Date.now() - 50000)]);
    const backend = await loadBackend(fake);

    const result = await backend.acquireRpm("key-1", 5);

    expect(result.ok).toBe(false);
    expect(fake.zadd).not.toHaveBeenCalled();
  });

  it("returns an error envelope when a Redis op throws", async () => {
    const fake = makeFakeClient();
    fake.zcard.mockRejectedValueOnce(new Error("connection reset"));
    const backend = await loadBackend(fake);

    const result = await backend.acquireRpm("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "error" });
  });

  it("fails closed when the backend is not connected", async () => {
    const fake = makeFakeClient();
    const { RedisBackend } = await import("@/lib/rateLimit/redis");
    const backend = new RedisBackend("redis://localhost:6379");
    backend.client = fake as never;
    backend.connected = false;

    const result = await backend.acquireRpm("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "error" });
    expect(fake.zcard).not.toHaveBeenCalled();
  });
});

describe("RedisBackend.releaseRpm", () => {
  it("removes the exact member when a request id is provided", async () => {
    const fake = makeFakeClient();
    const backend = await loadBackend(fake);

    await backend.releaseRpm("key-1", "member-abc");

    expect(fake.zrem).toHaveBeenCalledWith("ratelimit:rpm:key-1", "member-abc");
    expect(fake.zpopmax).not.toHaveBeenCalled();
  });

  it("pops the newest member as a fallback when the id is unknown", async () => {
    const fake = makeFakeClient();
    const backend = await loadBackend(fake);

    await backend.releaseRpm("key-1", undefined);

    expect(fake.zpopmax).toHaveBeenCalledWith("ratelimit:rpm:key-1", 1);
  });

  it("is a no-op when disconnected", async () => {
    const fake = makeFakeClient();
    const { RedisBackend } = await import("@/lib/rateLimit/redis");
    const backend = new RedisBackend("redis://localhost:6379");
    backend.client = fake as never;
    backend.connected = false;

    await backend.releaseRpm("key-1", "member-abc");

    expect(fake.zrem).not.toHaveBeenCalled();
  });
});

describe("RedisBackend.acquireConc", () => {
  it("grants a permit and its release decrements exactly once", async () => {
    const fake = makeFakeClient();
    fake.incr.mockResolvedValueOnce(1);
    const backend = await loadBackend(fake);

    const result = await backend.acquireConc("key-1", 5);

    expect(result).toMatchObject({ ok: true, type: "concurrent" });
    expect(fake.expire).toHaveBeenCalledWith("ratelimit:conc:key-1", 60);
    expect(result.ok && result.type === "concurrent" && typeof result.release).toBe("function");

    if (result.ok && result.type === "concurrent") {
      await result.release();
      await result.release(); // second call must be a no-op
    }

    expect(fake.decr).toHaveBeenCalledTimes(1);
  });

  it("denies when the concurrent count exceeds maxConc and decrements the slot", async () => {
    const fake = makeFakeClient();
    fake.incr.mockResolvedValueOnce(6);
    const backend = await loadBackend(fake);

    const result = await backend.acquireConc("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "concurrent" });
    expect(fake.decr).toHaveBeenCalledWith("ratelimit:conc:key-1");
  });

  it("decrements to undo the slot when expire fails after incr", async () => {
    const fake = makeFakeClient();
    fake.incr.mockResolvedValueOnce(1);
    fake.expire.mockRejectedValueOnce(new Error("expire failed"));
    const backend = await loadBackend(fake);

    const result = await backend.acquireConc("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "error" });
    expect(fake.decr).toHaveBeenCalledWith("ratelimit:conc:key-1");
  });

  it("returns an error envelope when incr throws", async () => {
    const fake = makeFakeClient();
    fake.incr.mockRejectedValueOnce(new Error("oom"));
    const backend = await loadBackend(fake);

    const result = await backend.acquireConc("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "error" });
  });

  it("fails closed when not connected", async () => {
    const fake = makeFakeClient();
    const { RedisBackend } = await import("@/lib/rateLimit/redis");
    const backend = new RedisBackend("redis://localhost:6379");
    backend.client = fake as never;
    backend.connected = false;

    const result = await backend.acquireConc("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "error" });
  });
});

describe("RedisBackend op timeout", () => {
  const originalEnv = { ...process.env };
  const originalWarn = console.warn;

  beforeEach(() => {
    process.env.RATELIMIT_REDIS_TIMEOUT_MS = "50";
    vi.resetModules();
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.warn = originalWarn;
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it("wraps a hanging Redis op in a timeout error envelope", async () => {
    const { RedisBackend } = await import("@/lib/rateLimit/redis");
    const backend = new RedisBackend("redis://localhost:6379");
    backend.client = {
      zcard: () => new Promise(() => {}), // never settles
      zremrangebyscore: async () => 0,
      expire: async () => 1,
      zrange: async () => [],
      zadd: async () => 1,
      close: vi.fn(),
    } as never;
    backend.connected = true;

    const result = await backend.acquireRpm("key-1", 5);

    expect(result).toEqual({ ok: false, retryAfterSeconds: 1, type: "error" });
  });
});
