import { beforeEach, describe, expect, it } from "vitest";

import { TRANSIENT_COOLDOWN_MS, DEFAULT_ERROR_MESSAGES } from "../../open-sse/config/errorConfig.js";
import {
  parseUpstreamError,
  unavailableResponse,
  formatProviderError,
  errorResponse,
} from "../../open-sse/utils/error.js";

// ─── parseUpstreamError ───────────────────────────────────────────────

describe("parseUpstreamError — extract error info from upstream responses", () => {
  it("parses OpenAI-compatible JSON error body", async () => {
    const body = JSON.stringify({ error: { message: "Rate limit exceeded", code: "rate_limit" } });
    const response = new Response(body, { status: 429 });
    const result = await parseUpstreamError(response);
    expect(result.statusCode).toBe(429);
    expect(result.message).toContain("Rate limit exceeded");
  });

  it("falls back to json.message when no error.message", async () => {
    const body = JSON.stringify({ message: "Too many requests" });
    const response = new Response(body, { status: 429 });
    const result = await parseUpstreamError(response);
    expect(result.statusCode).toBe(429);
    expect(result.message).toBe("Too many requests");
  });

  it("falls back to json.error when string", async () => {
    const body = JSON.stringify({ error: "unauthorized" });
    const response = new Response(body, { status: 401 });
    const result = await parseUpstreamError(response);
    expect(result.statusCode).toBe(401);
    expect(result.message).toBe("unauthorized");
  });

  it("uses DEFAULT_ERROR_MESSAGES when body is empty", async () => {
    const response = new Response("", { status: 502 });
    const result = await parseUpstreamError(response);
    expect(result.statusCode).toBe(502);
    expect(result.message).toBe(DEFAULT_ERROR_MESSAGES[502]);
  });

  it("uses raw body text when body is unparseable", async () => {
    const response = new Response("not json", { status: 503 });
    const result = await parseUpstreamError(response);
    expect(result.statusCode).toBe(503);
    // parseUpstreamError returns raw body text when JSON parse fails
    expect(result.message).toBe("not json");
  });

  it("returns resetsAtMs from executor.parseError", async () => {
    const executor = {
      // parseError must be sync — async returns a Promise object which is truthy but not awaited
      parseError: (res, body) => ({
        status: res.status,
        message: "custom error",
        resetsAtMs: Date.now() + 3600_000, // 1 hour
      }),
    };
    const response = new Response(JSON.stringify({ error: { message: "usage limit" } }), { status: 429 });
    const result = await parseUpstreamError(response, executor);
    expect(result.resetsAtMs).toBeDefined();
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
  });

  it("handles executor.parseError throwing gracefully", async () => {
    const executor = {
      parseError: () => {
        throw new Error("parser crashed");
      },
    };
    const response = new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    const result = await parseUpstreamError(response, executor);
    // Falls through to default parsing
    expect(result.statusCode).toBe(429);
    expect(result.message).toContain("rate limited");
  });

  it("handles executor without parseError method", async () => {
    const response = new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    const result = await parseUpstreamError(response, {});
    expect(result.statusCode).toBe(503);
    expect(result.message).toContain("overloaded");
  });
});

// ─── unavailableResponse ──────────────────────────────────────────────

describe("unavailableResponse — all-accounts-exhausted response", () => {
  it("returns response with correct status code", () => {
    const retryAfter = new Date(Date.now() + 30_000).toISOString();
    const res = unavailableResponse(429, "All accounts rate limited", retryAfter, "reset after 30s");
    expect(res.status).toBe(429);
  });

  it("includes Retry-After header with integer seconds", async () => {
    const retryAfter = new Date(Date.now() + 60_000).toISOString();
    const res = unavailableResponse(503, "Unavailable", retryAfter, "reset after 60s");
    const headerSeconds = Number(res.headers.get("Retry-After"));
    expect(headerSeconds).toBeGreaterThanOrEqual(58);
    expect(headerSeconds).toBeLessThanOrEqual(62);
  });

  it("Retry-After header minimum of 1s for already-elapsed timestamps", () => {
    const retryAfter = new Date(Date.now() - 10_000).toISOString();
    const res = unavailableResponse(429, "Exhausted", retryAfter, "reset after 0s");
    expect(Number(res.headers.get("Retry-After"))).toBe(1);
  });

  it("appends human retry info to error message", async () => {
    const retryAfter = new Date(Date.now() + 30_000).toISOString();
    const res = unavailableResponse(502, "Bad gateway from provider", retryAfter, "reset after 30s");
    const body = await res.json();
    expect(body.error.message).toContain("Bad gateway from provider");
    expect(body.error.message).toContain("reset after 30s");
  });
});

// ─── errorResponse ────────────────────────────────────────────────────

describe("errorResponse — standard error response", () => {
  it("returns response with status and JSON body", async () => {
    const res = errorResponse(502, "Bad gateway");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.message).toBe("Bad gateway");
    expect(body.error.type).toBe("server_error");
    expect(body.error.code).toBe("bad_gateway");
  });

  it("uses correct error type per status code", async () => {
    const res = await errorResponse(429, "Rate limit").json();
    expect(res.error.type).toBe("rate_limit_error");
    expect(res.error.code).toBe("rate_limit_exceeded");
  });
});

// ─── formatProviderError ──────────────────────────────────────────────

describe("formatProviderError — provider error formatting", () => {
  it("includes cause code and message", () => {
    const cause = new Error("socket hang up");
    cause.code = "UND_ERR_SOCKET";
    const error = new Error("Fetch failed", { cause });
    const msg = formatProviderError(error, "openai", "gpt-5", 502);
    expect(msg).toContain("UND_ERR_SOCKET");
    expect(msg).toContain("socket hang up");
  });

  it("includes cause message even when no cause.code", () => {
    const cause = new Error("connect ETIMEDOUT 1.2.3.4:443");
    const error = new Error("Fetch timeout", { cause });
    const msg = formatProviderError(error, "openai", "gpt-5", 504);
    expect(msg).toContain("ETIMEDOUT");
    // formatProviderError always wraps cause info with "(cause: ...)"
    expect(msg).toContain("cause:");
  });

  it("handles error without cause", () => {
    const error = new Error("Simple error");
    const msg = formatProviderError(error, "anthropic", "claude-4", 500);
    expect(msg).toBe("[500]: Simple error");
  });

  it("uses FETCH_FAILED when no statusCode or error.code", () => {
    const error = new Error("Network error");
    const msg = formatProviderError(error, "openai", "gpt-5", null);
    expect(msg).toContain("[FETCH_FAILED]");
  });
});

// ─── Integration: markAccountUnavailable with 5xx ─────────────────────

// Re-use the same DB setup pattern
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-upstream-err-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/sqlite/connection.ts");
  closeDatabase();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

const PROVIDER = "openai";

async function seedConnection(overrides = {}) {
  const { createProviderConnection } = await import("@/lib/localDb.js");
  return await createProviderConnection({
    provider: PROVIDER,
    authType: "apikey",
    name: overrides.name || `conn-${Math.random().toString(36).slice(2, 8)}`,
    apiKey: overrides.apiKey || "sk-test",
    isActive: true,
    ...overrides,
  });
}

async function readConn(id) {
  const { getProviderConnectionById } = await import("@/lib/localDb.js");
  return await getProviderConnectionById(id);
}

async function clearCaches() {
  const { invalidateConnectionsCache } = await import("@/sse/services/auth.js");
  invalidateConnectionsCache();
}

beforeEach(async () => {
  const { importDb } = await import("@/lib/localDb.js");
  await importDb({
    providerConnections: [],
    providerNodes: [],
    proxyPools: [],
    modelAliases: {},
    combos: [],
    apiKeys: [],
    customModels: [],
    settings: {},
    pricing: {},
  });
  await clearCaches();
});

describe("markAccountUnavailable — 5xx error path", () => {
  it("treats 502 as transient error (TRANSIENT_COOLDOWN_MS)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockKey } = await import("open-sse/services/accountFallback.js");

    const before = Date.now();
    const result = await markAccountUnavailable(
      conn.id,
      502,
      "Bad gateway - upstream provider error",
      PROVIDER,
      "gpt-5",
    );
    expect(result.shouldFallback).toBe(true);
    // 502 is unmatched → fall through to TRANSIENT_COOLDOWN_MS = 30s
    expect(result.cooldownMs).toBe(TRANSIENT_COOLDOWN_MS);

    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated[getModelLockKey("gpt-5")]).getTime();
    expect(lockExpiry - before).toBeGreaterThan(TRANSIENT_COOLDOWN_MS - 1000);
    expect(lockExpiry - before).toBeLessThan(TRANSIENT_COOLDOWN_MS + 3000);
  });

  it("treats 503 as transient error (TRANSIENT_COOLDOWN_MS)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockKey } = await import("open-sse/services/accountFallback.js");

    const before = Date.now();
    await markAccountUnavailable(conn.id, 503, "Service temporarily unavailable", PROVIDER, "gpt-5");
    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated[getModelLockKey("gpt-5")]).getTime();
    expect(lockExpiry - before).toBeGreaterThan(TRANSIENT_COOLDOWN_MS - 1000);
    expect(lockExpiry - before).toBeLessThan(TRANSIENT_COOLDOWN_MS + 3000);
  });

  it("treats 504 as transient error (TRANSIENT_COOLDOWN_MS)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockKey } = await import("open-sse/services/accountFallback.js");

    const before = Date.now();
    await markAccountUnavailable(conn.id, 504, "Gateway timeout", PROVIDER, "gpt-5");
    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated[getModelLockKey("gpt-5")]).getTime();
    expect(lockExpiry - before).toBeGreaterThan(TRANSIENT_COOLDOWN_MS - 1000);
    expect(lockExpiry - before).toBeLessThan(TRANSIENT_COOLDOWN_MS + 3000);
  });

  it("respects resetsAtMs from provider-specific error (e.g. codex usage_limit_reached)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockKey } = await import("open-sse/services/accountFallback.js");

    // Simulate codex providing resetsAtMs = 2 minutes from now
    const resetsAtMs = Date.now() + 120_000;
    const result = await markAccountUnavailable(conn.id, 429, "usage_limit_reached", PROVIDER, "gpt-5", resetsAtMs);
    expect(result.shouldFallback).toBe(true);
    // resetsAtMs overrides backoff — cooldown should be ~120s (capped at MAX_RATE_LIMIT_COOLDOWN_MS)
    expect(result.cooldownMs).toBeGreaterThan(119_000);
    expect(result.cooldownMs).toBeLessThan(121_000);

    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated[getModelLockKey("gpt-5")]).getTime();
    expect(lockExpiry - Date.now()).toBeGreaterThan(119_000);
    expect(lockExpiry - Date.now()).toBeLessThan(121_000);
  });

  it("backoffLevel increments on consecutive 429 errors across same connection", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    // 429 with rate limit text → exponential backoff (backoff=true)
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-a");
    let updated = await readConn(conn.id);
    expect(updated.backoffLevel).toBe(1);

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-b");
    updated = await readConn(conn.id);
    expect(updated.backoffLevel).toBe(2);

    // 5xx does NOT increment backoffLevel via backoff=true — it uses TRANSIENT_COOLDOWN_MS
    // which doesn't set newBackoffLevel. So backoffLevel stays at 2.
    await markAccountUnavailable(conn.id, 502, "Bad gateway", PROVIDER, "gpt-c");
    updated = await readConn(conn.id);
    expect(updated.backoffLevel).toBe(2);
  });
});

describe("account fallback loop simulation", () => {
  it("getProviderCredentials skips locked connection after 5xx error", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });

    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } = await import(
      "@/sse/services/auth.js"
    );

    // Simulate 503 on connA
    await markAccountUnavailable(connA.id, 503, "Service unavailable", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    const creds = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(creds.connectionId).toBe(connB.id);
  });

  it("all accounts locked after 5xx → allRateLimited returned with retryAfter", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });

    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } = await import(
      "@/sse/services/auth.js"
    );

    await markAccountUnavailable(connA.id, 503, "Unavailable", PROVIDER, "gpt-5");
    await markAccountUnavailable(connB.id, 502, "Bad gateway", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    const result = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(result.allRateLimited).toBe(true);
    expect(result.retryAfter).toBeTruthy();
    expect(result.retryAfterHuman).toMatch(/reset after/);
  });

  it("clearAccountError clears lock and resets error state on success after 5xx", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 503, "Overloaded", PROVIDER, "gpt-5");
    let updated = await readConn(conn.id);
    expect(updated.testStatus).toBe("unavailable");
    expect(updated.lastError).toBe("Overloaded");

    await clearAccountError(conn.id, updated, "gpt-5");
    const after = await readConn(conn.id);
    expect(after.testStatus).toBe("active");
    expect(after.lastError).toBeNull();
    expect(after.lastErrorAt).toBeNull();
  });
});
