import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BACKOFF_CONFIG, MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-modellock-test-"));
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
  const conn = await createProviderConnection({
    provider: PROVIDER,
    authType: "apikey",
    name: overrides.name || `conn-${Math.random().toString(36).slice(2, 8)}`,
    apiKey: overrides.apiKey || "sk-test",
    isActive: true,
    ...overrides,
  });
  return conn;
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
    settings: { minimumLockoutMinutes: 0 },
    pricing: {},
  });
  await clearCaches();
});

describe("markAccountUnavailable — persists model lock to SQLite", () => {
  it("writes modelLock_<model> with future expiry and sets error metadata", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const before = Date.now();
    const result = await markAccountUnavailable(
      conn.id,
      429,
      "rate limit exceeded",
      PROVIDER,
      "gpt-5",
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);

    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated["modelLock_gpt-5"]).getTime();
    // Lock must be in the future (cooldownMs > 0)
    expect(lockExpiry).toBeGreaterThan(before);
    expect(updated.testStatus).toBe("unavailable");
    expect(updated.errorCode).toBe(429);
    expect(updated.lastError).toBeTruthy();
    expect(updated.lastErrorAt).toBeTruthy();
  });

  it("uses modelLock___all key when model is null", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, null);

    const updated = await readConn(conn.id);
    expect(updated.modelLock___all).toBeTruthy();
  });

  it("increments backoffLevel on each 429", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-a");
    let updated = await readConn(conn.id);
    expect(updated.backoffLevel).toBe(1);

    // Different model → no read-before-write guard, fresh write
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-b");
    updated = await readConn(conn.id);
    expect(updated.backoffLevel).toBe(2);
  });

  it("read-before-write guard: re-marking the SAME model while lock active does not re-update lastErrorAt", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-x");
    const first = await readConn(conn.id);

    // small delay to ensure timestamps would differ if rewritten
    await new Promise((r) => setTimeout(r, 25));

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded again", PROVIDER, "gpt-x");
    const second = await readConn(conn.id);

    expect(second.lastErrorAt).toBe(first.lastErrorAt);
    expect(second.backoffLevel).toBe(first.backoffLevel);
    expect(second.lastError).toBe("rate limit exceeded");
  });

  it("uses provider-precise resetsAtMs, capped at MAX_RATE_LIMIT_COOLDOWN_MS", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    // 6 hours in the future — must be clamped to 30 min
    const resetsAtMs = Date.now() + 6 * 60 * 60 * 1000;
    const result = await markAccountUnavailable(
      conn.id,
      429,
      "usage_limit_reached",
      PROVIDER,
      "gpt-y",
      resetsAtMs,
    );
    expect(result.cooldownMs).toBeLessThanOrEqual(MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(result.cooldownMs).toBeGreaterThan(MAX_RATE_LIMIT_COOLDOWN_MS - 1000);

    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated["modelLock_gpt-y"]).getTime();
    expect(lockExpiry - Date.now()).toBeLessThanOrEqual(MAX_RATE_LIMIT_COOLDOWN_MS + 100);
  });

  it("noauth connectionId is a no-op", async () => {
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const r = await markAccountUnavailable("noauth", 429, "rate limit", PROVIDER, "gpt-z");
    expect(r).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });
});

describe("clearAccountError — clears succeeded model + expired locks", () => {
  it("clears only the succeeded model's lock, keeps active locks on other models", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-a");
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-b");

    const before = await readConn(conn.id);
    expect(before["modelLock_gpt-a"]).toBeTruthy();
    expect(before["modelLock_gpt-b"]).toBeTruthy();
    expect(before.testStatus).toBe("unavailable");

    await clearAccountError(conn.id, before, "gpt-a");

    const after = await readConn(conn.id);
    expect(after["modelLock_gpt-a"]).toBeFalsy();
    expect(after["modelLock_gpt-b"]).toBeTruthy();
    // testStatus must remain 'unavailable' because gpt-b lock is still active
    expect(after.testStatus).toBe("unavailable");
    expect(after.lastError).toBe("rate limit exceeded");
  });

  it("lazily clears expired modelLock_* keys on any success", async () => {
    const conn = await seedConnection();
    const { updateProviderConnection } = await import("@/lib/localDb.js");
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");

    // Pre-seed an already-expired lock for a different model
    await updateProviderConnection(conn.id, {
      "modelLock_old-model": new Date(Date.now() - 60_000).toISOString(),
    });

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-new");
    const before = await readConn(conn.id);
    expect(before["modelLock_old-model"]).toBeTruthy(); // still present but expired
    expect(before["modelLock_gpt-new"]).toBeTruthy();

    await clearAccountError(conn.id, before, "gpt-new");

    const after = await readConn(conn.id);
    expect(after["modelLock_old-model"]).toBeFalsy();
    expect(after["modelLock_gpt-new"]).toBeFalsy();
    expect(after.testStatus).toBe("active");
    expect(after.lastError).toBeNull();
    expect(after.backoffLevel).toBe(0);
  });

  it("also clears account-level lock (modelLock___all) on any model success", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, null);
    const before = await readConn(conn.id);
    expect(before.modelLock___all).toBeTruthy();

    await clearAccountError(conn.id, before, "any-model");
    const after = await readConn(conn.id);
    expect(after.modelLock___all).toBeFalsy();
    expect(after.testStatus).toBe("active");
  });

  it("noauth connectionId is a no-op", async () => {
    const { clearAccountError } = await import("@/sse/services/auth.js");
    await expect(clearAccountError("noauth", {}, "gpt-5")).resolves.toBeUndefined();
  });
});

describe("getProviderCredentials — connection selection respects model locks", () => {
  it("skips locked connection, returns next available", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });

    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");

    await markAccountUnavailable(connA.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    const creds = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(creds.connectionId).toBe(connB.id);
  });

  it("lock on model X does NOT affect requests for model Y on the same connection", async () => {
    const conn = await seedConnection({ name: "solo", priority: 1 });

    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    // Same connection should still be selectable for a different model
    const creds = await getProviderCredentials(PROVIDER, null, "gpt-4o-mini");
    expect(creds.connectionId).toBe(conn.id);

    // But not for the locked model
    const lockedResult = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(lockedResult.allRateLimited).toBe(true);
    expect(lockedResult.retryAfter).toBeTruthy();
  });

  it("when all connections are locked for a model, returns allRateLimited with earliest retryAfter", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });

    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");

    await markAccountUnavailable(connA.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    await markAccountUnavailable(connB.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    const result = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(result.allRateLimited).toBe(true);
    expect(result.retryAfter).toBeTruthy();
    expect(result.retryAfterHuman).toMatch(/reset after/);

    const connAUpdated = await readConn(connA.id);
    expect(result.retryAfter).toBe(connAUpdated["modelLock_gpt-5"]);
  });

  it("after lock expires, connection becomes selectable again", async () => {
    const conn = await seedConnection({ name: "expirable", priority: 1 });
    const { updateProviderConnection } = await import("@/lib/localDb.js");
    const { getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");

    // Manually set an already-expired lock
    await updateProviderConnection(conn.id, {
      "modelLock_gpt-5": new Date(Date.now() - 60_000).toISOString(),
      testStatus: "unavailable",
    });
    invalidateConnectionsCache();

    const creds = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(creds.connectionId).toBe(conn.id);
  });

  it("excludeConnectionIds skips a given connection even when not locked", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });

    const { getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");
    invalidateConnectionsCache();

    const creds = await getProviderCredentials(PROVIDER, connA.id, "gpt-5");
    expect(creds.connectionId).toBe(connB.id);
  });
});

describe("backoff escalation across separate errors", () => {
  it("backoffLevel grows; cooldown doubles each step (capped at BACKOFF_CONFIG.max)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const r1 = await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "m1");
    const r2 = await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "m2");
    const r3 = await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "m3");

    expect(r1.cooldownMs).toBe(BACKOFF_CONFIG.base);
    expect(r2.cooldownMs).toBe(BACKOFF_CONFIG.base * 2);
    expect(r3.cooldownMs).toBe(BACKOFF_CONFIG.base * 4);

    const updated = await readConn(conn.id);
    expect(updated.backoffLevel).toBe(3);
  });
});

describe("connection-level lock (account-wide lockdown)", () => {
  it("401 triggers connection-level lock, not model lock", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const result = await markAccountUnavailable(conn.id, 401, "Unauthorized", PROVIDER, "gpt-5");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(60 * 60 * 1000); // 1h base

    const updated = await readConn(conn.id);
    expect(updated.connectionLockUntil).toBeTruthy();
    expect(updated.connectionLockCount).toBe(1);
    expect(updated.testStatus).toBe("unavailable");
    // model lock should NOT be set
    expect(updated["modelLock_gpt-5"]).toBeFalsy();
  });

  it("suspicious activity 429 triggers connection-level lock", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const result = await markAccountUnavailable(
      conn.id,
      429,
      '{"message":"Due to suspicious activity, we are imposing temporary limits on how frequently your account can send a request"}',
      PROVIDER,
      "kiro-model",
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(60 * 60 * 1000); // 1h

    const updated = await readConn(conn.id);
    expect(updated.connectionLockUntil).toBeTruthy();
    expect(updated.connectionLockCount).toBe(1);
    expect(updated["modelLock_kiro-model"]).toBeFalsy();
  });

  it("connection lock count escalates exponentially (1h, 2h, 3h)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");

    const r1 = await markAccountUnavailable(conn.id, 401, "Unauthorized", PROVIDER, "m");
    expect(r1.cooldownMs).toBe(1 * 60 * 60 * 1000);

    const r2 = await markAccountUnavailable(conn.id, 401, "Unauthorized", PROVIDER, "m");
    expect(r2.cooldownMs).toBe(2 * 60 * 60 * 1000);

    const r3 = await markAccountUnavailable(conn.id, 401, "Unauthorized", PROVIDER, "m");
    expect(r3.cooldownMs).toBe(3 * 60 * 60 * 1000);

    const updated = await readConn(conn.id);
    expect(updated.connectionLockCount).toBe(3);
  });

  it("connection-locked connection is skipped by getProviderCredentials", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });
    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");

    await markAccountUnavailable(connA.id, 401, "Unauthorized", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    const creds = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(creds.connectionId).toBe(connB.id);
  });

  it("when all connections are connection-locked, returns allRateLimited", async () => {
    const connA = await seedConnection({ name: "A", priority: 1 });
    const connB = await seedConnection({ name: "B", priority: 2 });
    const { markAccountUnavailable, getProviderCredentials, invalidateConnectionsCache } =
      await import("@/sse/services/auth.js");

    await markAccountUnavailable(connA.id, 401, "Unauthorized", PROVIDER, "gpt-5");
    await markAccountUnavailable(connB.id, 401, "Unauthorized", PROVIDER, "gpt-5");
    invalidateConnectionsCache();

    const result = await getProviderCredentials(PROVIDER, null, "gpt-5");
    expect(result.allRateLimited).toBe(true);
    expect(result.retryAfter).toBeTruthy();
    expect(result.retryAfterHuman).toMatch(/reset after/);
  });

  it("expired connection lock is cleared on next success", async () => {
    const conn = await seedConnection();
    const { updateProviderConnection } = await import("@/lib/localDb.js");
    const { clearAccountError } = await import("@/sse/services/auth.js");

    // Seed an already-expired connection lock
    await updateProviderConnection(conn.id, {
      connectionLockUntil: new Date(Date.now() - 60_000).toISOString(),
      connectionLockCount: 2,
      connectionLockReason: "old error",
      testStatus: "unavailable",
    });

    const before = await readConn(conn.id);
    await clearAccountError(conn.id, before, "gpt-5");

    const after = await readConn(conn.id);
    expect(after.connectionLockUntil).toBeFalsy();
    expect(after.connectionLockCount).toBeFalsy();
    expect(after.connectionLockReason).toBeFalsy();
    expect(after.testStatus).toBe("active");
  });
});
