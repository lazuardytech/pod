import { describe, expect, it } from "vitest";
import {
  BACKOFF_CONFIG,
  msUntilMidnightVN,
  msUntilNextMinute,
  TRANSIENT_COOLDOWN_MS,
} from "../../open-sse/config/errorConfig.js";
import {
  buildClearModelLocksUpdate,
  buildModelLockUpdate,
  checkFallbackError,
  filterAvailableAccounts,
  formatRetryAfter,
  getEarliestModelLockUntil,
  getEarliestRateLimitedUntil,
  getModelLockKey,
  getQuotaCooldown,
  getUnavailableUntil,
  isAccountUnavailable,
  isModelLockActive,
  MODEL_LOCK_ALL,
  MODEL_LOCK_PREFIX,
} from "../../open-sse/services/accountFallback.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe("getQuotaCooldown — exponential backoff", () => {
  it("returns base cooldown at level 1", () => {
    expect(getQuotaCooldown(1)).toBe(BACKOFF_CONFIG.base);
  });

  it("doubles each level", () => {
    expect(getQuotaCooldown(2)).toBe(BACKOFF_CONFIG.base * 2);
    expect(getQuotaCooldown(3)).toBe(BACKOFF_CONFIG.base * 4);
    expect(getQuotaCooldown(4)).toBe(BACKOFF_CONFIG.base * 8);
  });

  it("caps at BACKOFF_CONFIG.max", () => {
    expect(getQuotaCooldown(99)).toBe(BACKOFF_CONFIG.max);
    expect(getQuotaCooldown(BACKOFF_CONFIG.maxLevel)).toBe(BACKOFF_CONFIG.max);
  });

  it("floors level<=0 to base", () => {
    expect(getQuotaCooldown(0)).toBe(BACKOFF_CONFIG.base);
    expect(getQuotaCooldown(-5)).toBe(BACKOFF_CONFIG.base);
  });
});

describe("checkFallbackError — error classification", () => {
  it("matches 'daily token limit' → lock until midnight VN", () => {
    const r = checkFallbackError(429, "You have hit the daily token limit");
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(0);
    // Should be roughly msUntilMidnightVN — allow 2s drift
    expect(Math.abs(r.cooldownMs - msUntilMidnightVN())).toBeLessThan(2000);
  });

  it("matches per-minute rate limit (RPM) → lock until next minute", () => {
    const r = checkFallbackError(429, "max 30 req/min exceeded");
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(0);
    expect(Math.abs(r.cooldownMs - msUntilNextMinute())).toBeLessThan(2000);
  });

  it("matches 'rate limit' text → exponential backoff, increments level", () => {
    const r = checkFallbackError(429, "rate limit exceeded", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(1);
    expect(r.cooldownMs).toBe(BACKOFF_CONFIG.base);

    const r2 = checkFallbackError(429, "rate limit exceeded", 3);
    expect(r2.newBackoffLevel).toBe(4);
    expect(r2.cooldownMs).toBe(BACKOFF_CONFIG.base * 8);
  });

  it("caps backoffLevel at maxLevel", () => {
    const r = checkFallbackError(429, "too many requests", BACKOFF_CONFIG.maxLevel + 10);
    expect(r.newBackoffLevel).toBe(BACKOFF_CONFIG.maxLevel);
    expect(r.cooldownMs).toBe(BACKOFF_CONFIG.max);
  });

  it("falls back to 401/403/404 fixed cooldowns when text does not match", () => {
    expect(checkFallbackError(401, "Unauthorized").cooldownMs).toBe(2 * MINUTE);
    expect(checkFallbackError(402, "Payment required").cooldownMs).toBe(2 * MINUTE);
    expect(checkFallbackError(403, "Forbidden").cooldownMs).toBe(2 * MINUTE);
    expect(checkFallbackError(404, "Not found").cooldownMs).toBe(2 * MINUTE);
  });

  it("status 429 with no matching text → backoff", () => {
    const r = checkFallbackError(429, "Some opaque server message", 0);
    expect(r.newBackoffLevel).toBe(1);
    expect(r.cooldownMs).toBe(BACKOFF_CONFIG.base);
  });

  it("text rules take priority over status rules", () => {
    // "request not allowed" is 5s, status 401 would be 2m
    const r = checkFallbackError(401, "Request not allowed for this user");
    expect(r.cooldownMs).toBe(5 * SECOND);
  });

  it("unmatched error falls back to TRANSIENT_COOLDOWN_MS", () => {
    const r = checkFallbackError(599, "weird custom error");
    expect(r.cooldownMs).toBe(TRANSIENT_COOLDOWN_MS);
  });

  it("accepts object errorText by JSON-stringifying", () => {
    const r = checkFallbackError(429, { error: { message: "rate limit exceeded" } });
    expect(r.cooldownMs).toBe(BACKOFF_CONFIG.base);
    expect(r.newBackoffLevel).toBe(1);
  });

  it("handles null/empty errorText", () => {
    const r = checkFallbackError(429, null);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBe(BACKOFF_CONFIG.base);
  });

  it("matches case-insensitively", () => {
    const r = checkFallbackError(0, "RATE LIMIT");
    expect(r.cooldownMs).toBe(BACKOFF_CONFIG.base);
  });
});

describe("model lock helpers", () => {
  it("getModelLockKey builds per-model key, falls back to __all", () => {
    expect(getModelLockKey("gpt-5")).toBe(`${MODEL_LOCK_PREFIX}gpt-5`);
    expect(getModelLockKey(null)).toBe(MODEL_LOCK_ALL);
    expect(getModelLockKey(undefined)).toBe(MODEL_LOCK_ALL);
    expect(getModelLockKey("")).toBe(MODEL_LOCK_ALL);
  });

  it("isModelLockActive returns true when lock in future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const conn = { modelLock_gpt5: future };
    expect(isModelLockActive(conn, "gpt5")).toBe(true);
  });

  it("isModelLockActive returns false when lock expired", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const conn = { modelLock_gpt5: past };
    expect(isModelLockActive(conn, "gpt5")).toBe(false);
  });

  it("isModelLockActive returns false when key absent", () => {
    expect(isModelLockActive({}, "gpt5")).toBe(false);
    expect(isModelLockActive({ modelLock_gpt5: null }, "gpt5")).toBe(false);
  });

  it("isModelLockActive considers account-level lock (modelLock___all) for a specific model", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const conn = { [MODEL_LOCK_ALL]: future };
    expect(isModelLockActive(conn, "gpt5")).toBe(true);
    expect(isModelLockActive(conn, null)).toBe(true);
  });

  it("getEarliestModelLockUntil returns nearest active expiry, ignoring expired", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const soon = new Date(Date.now() + 5_000).toISOString();
    const later = new Date(Date.now() + 60_000).toISOString();
    const conn = { modelLock_a: past, modelLock_b: later, modelLock_c: soon };
    expect(getEarliestModelLockUntil(conn)).toBe(soon);
  });

  it("getEarliestModelLockUntil returns null when no active lock", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    expect(getEarliestModelLockUntil({ modelLock_a: past })).toBeNull();
    expect(getEarliestModelLockUntil({})).toBeNull();
    expect(getEarliestModelLockUntil(null)).toBeNull();
  });

  it("buildModelLockUpdate returns a single-key object with future ISO expiry", () => {
    const update = buildModelLockUpdate("gpt-5", 60_000);
    expect(Object.keys(update)).toEqual(["modelLock_gpt-5"]);
    const expiry = new Date(update["modelLock_gpt-5"]).getTime();
    expect(expiry).toBeGreaterThan(Date.now() + 59_000);
    expect(expiry).toBeLessThan(Date.now() + 61_500);
  });

  it("buildModelLockUpdate uses __all key when model is null", () => {
    const update = buildModelLockUpdate(null, 30_000);
    expect(Object.keys(update)).toEqual([MODEL_LOCK_ALL]);
  });

  it("buildClearModelLocksUpdate nulls every modelLock_* key only", () => {
    const conn = {
      id: "x",
      provider: "openai",
      modelLock_gpt5: "2030-01-01T00:00:00Z",
      modelLock_gpt4: "2030-01-01T00:00:00Z",
      lastError: "boom",
    };
    const update = buildClearModelLocksUpdate(conn);
    expect(update).toEqual({ modelLock_gpt5: null, modelLock_gpt4: null });
    expect("lastError" in update).toBe(false);
    expect("id" in update).toBe(false);
  });
});

describe("isAccountUnavailable", () => {
  it("true if rateLimitedUntil in future", () => {
    expect(isAccountUnavailable(new Date(Date.now() + 60_000).toISOString())).toBe(true);
  });

  it("false if expired or null", () => {
    expect(isAccountUnavailable(new Date(Date.now() - 60_000).toISOString())).toBe(false);
    expect(isAccountUnavailable(null)).toBe(false);
    expect(isAccountUnavailable(undefined)).toBe(false);
  });
});

describe("getUnavailableUntil", () => {
  it("returns ISO string offset from now", () => {
    const iso = getUnavailableUntil(5000);
    const t = new Date(iso).getTime();
    expect(t).toBeGreaterThan(Date.now() + 4500);
    expect(t).toBeLessThan(Date.now() + 5500);
  });
});

describe("getEarliestRateLimitedUntil", () => {
  it("returns earliest future timestamp across accounts", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const soon = new Date(Date.now() + 5_000).toISOString();
    const later = new Date(Date.now() + 60_000).toISOString();
    const list = [
      { rateLimitedUntil: past },
      { rateLimitedUntil: later },
      { rateLimitedUntil: soon },
      { rateLimitedUntil: null },
    ];
    expect(getEarliestRateLimitedUntil(list)).toBe(soon);
  });

  it("returns null when no accounts in cooldown", () => {
    expect(getEarliestRateLimitedUntil([])).toBeNull();
    expect(getEarliestRateLimitedUntil([{ rateLimitedUntil: null }])).toBeNull();
  });
});

describe("formatRetryAfter", () => {
  it("formats hours/minutes/seconds", () => {
    const future = new Date(Date.now() + (2 * 3600 + 5 * 60 + 30) * 1000).toISOString();
    expect(formatRetryAfter(future)).toMatch(/reset after 2h 5m \d+s/);
  });

  it("formats seconds-only", () => {
    const future = new Date(Date.now() + 45_000).toISOString();
    expect(formatRetryAfter(future)).toMatch(/^reset after \d+s$/);
  });

  it("handles already-elapsed timestamps", () => {
    expect(formatRetryAfter(new Date(Date.now() - 60_000).toISOString())).toBe("reset after 0s");
  });

  it("empty input → empty string", () => {
    expect(formatRetryAfter(null)).toBe("");
    expect(formatRetryAfter(undefined)).toBe("");
  });
});

describe("filterAvailableAccounts", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const accounts = [
    { id: "a", rateLimitedUntil: null },
    { id: "b", rateLimitedUntil: future },
    { id: "c", rateLimitedUntil: past },
  ];

  it("excludes rate-limited accounts but keeps expired ones", () => {
    const result = filterAvailableAccounts(accounts);
    expect(result.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("excludes specific id when requested", () => {
    const result = filterAvailableAccounts(accounts, "a");
    expect(result.map((a) => a.id)).toEqual(["c"]);
  });
});
