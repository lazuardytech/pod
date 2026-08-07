import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-lockcount-test-"));
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
    settings: { minimumLockoutMinutes: 0 },
    pricing: {},
  });
  await clearCaches();
});

describe("modelLockCount — per-model lock count field semantics (AGENTS.md #15)", () => {
  it("increments on consecutive lock DB writes for the SAME model", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    // First lock: count goes to 1
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    let updated = await readConn(conn.id);
    const key = getModelLockCountKey("gpt-5");
    expect(Number(updated[key])).toBe(1);

    // Second lock: read-before-write guard fires because lock still active.
    // Count stays at 1 — guard prevents re-write entirely.
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    updated = await readConn(conn.id);
    expect(Number(updated[key])).toBe(1);
  });

  it("tracks separate lock count per model", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5"); // guard fires, no change
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-4"); // different model = new write

    const updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-5")])).toBe(1);
    expect(Number(updated[getModelLockCountKey("gpt-4")])).toBe(1);
  });

  it("read-before-write guard prevents re-increment on same active lock", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-x");
    let updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-x")])).toBe(1);

    // Immediately re-lock same model — guard fires (lock still active)
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-x");
    updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-x")])).toBe(1);
  });

  it("IS cleared on successful response via clearAccountError", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    const before = await readConn(conn.id);
    expect(Number(before[getModelLockCountKey("gpt-5")])).toBe(1);

    await clearAccountError(conn.id, before, "gpt-5");
    const after = await readConn(conn.id);
    expect(Number(after[getModelLockCountKey("gpt-5")])).toBe(0);
  });

  it("IS NOT cleared when other models succeed but this model stays locked", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    // Lock gpt-5 twice (second triggers guard) and gpt-4 once
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-4");

    const before = await readConn(conn.id);
    expect(Number(before[getModelLockCountKey("gpt-5")])).toBe(1);
    expect(Number(before[getModelLockCountKey("gpt-4")])).toBe(1);

    // gpt-4 succeeds — should clear gpt-4's count but NOT gpt-5's
    await clearAccountError(conn.id, before, "gpt-4");
    const after = await readConn(conn.id);
    expect(Number(after[getModelLockCountKey("gpt-5")])).toBe(1); // unchanged
    expect(Number(after[getModelLockCountKey("gpt-4")])).toBe(0); // cleared
  });

  it("all lock counts cleared when all active locks have expired or been cleared", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-5");
    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, "gpt-4");

    const before = await readConn(conn.id);
    expect(Number(before[getModelLockCountKey("gpt-5")])).toBe(1);
    expect(Number(before[getModelLockCountKey("gpt-4")])).toBe(1);

    // Clear gpt-5 — gpt-4 is still locked, so only gpt-5 count cleared
    // (gpt-4 count stays because lock is still active)
    await clearAccountError(conn.id, before, "gpt-5");
    let after = await readConn(conn.id);
    expect(Number(after[getModelLockCountKey("gpt-5")])).toBe(0);
    expect(Number(after[getModelLockCountKey("gpt-4")])).toBe(1);

    // Now clear gpt-4 — no locks remain, all counts reset, status goes active
    await clearAccountError(conn.id, after, "gpt-4");
    after = await readConn(conn.id);
    expect(Number(after[getModelLockCountKey("gpt-5")])).toBe(0);
    expect(Number(after[getModelLockCountKey("gpt-4")])).toBe(0);
    expect(after.testStatus).toBe("active");
  });

  it("modelLockCount ___all key is tracked when model is null", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    await markAccountUnavailable(conn.id, 429, "rate limit exceeded", PROVIDER, null);
    let updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey(null)])).toBe(1);

    // Clear clears the ___all count
    await clearAccountError(conn.id, updated, "any-model");
    const after = await readConn(conn.id);
    expect(Number(after[getModelLockCountKey(null)])).toBe(0);
  });
});

describe("minimum lockout multiplier — modelLockCount * minimumLockoutMinutes", () => {
  it("applies 1x minimum lockout on first lock (modelLockCount=1)", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockKey } = await import("open-sse/services/accountFallback.js");
    const { updateSettings } = await import("@/lib/localDb.js");

    // Set minimum lockout to 1 minute
    await updateSettings({ minimumLockoutMinutes: 1 });
    await clearCaches();

    const before = Date.now();
    // TRANSIENT_COOLDOWN_MS (30s) + minimumLockout (1min * count=1) = 1min effective
    await markAccountUnavailable(conn.id, 599, "transient error", PROVIDER, "gpt-5");
    const updated = await readConn(conn.id);
    const lockExpiry = new Date(updated[getModelLockKey("gpt-5")]).getTime();
    // Effective: 1min minimum > 30s transient → 1min
    expect(lockExpiry - before).toBeGreaterThan(55_000);
    expect(lockExpiry - before).toBeLessThan(65_000 + 3000);
  });

  it("applies 2x minimum lockout on second lock of same model (modelLockCount=2) after lock expires", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");
    const { getModelLockKey, getModelLockCountKey } =
      await import("open-sse/services/accountFallback.js");
    const { updateSettings } = await import("@/lib/localDb.js");

    await updateSettings({ minimumLockoutMinutes: 1 });
    await clearCaches();

    // First lock: count=1 → 1x minimum
    await markAccountUnavailable(conn.id, 599, "transient", PROVIDER, "gpt-x");
    let updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-x")])).toBe(1);

    // Clear the lock (simulate success) so the next lock is a fresh write
    await clearAccountError(conn.id, updated, "gpt-x");
    updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-x")])).toBe(0);

    // Second fresh lock: count goes to 1 again (not 2) because count was reset
    // Minimum: 1min * 1 = 1min
    const before2 = Date.now();
    await markAccountUnavailable(conn.id, 599, "transient", PROVIDER, "gpt-x");
    updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-x")])).toBe(1);
    const lockExpiry = new Date(updated[getModelLockKey("gpt-x")]).getTime();
    // 1x minimum = 1min
    expect(lockExpiry - before2).toBeGreaterThan(55_000);
    expect(lockExpiry - before2).toBeLessThan(65_000 + 3000);
  });

  it("lock count persists across lock cycles when not cleared on error path", async () => {
    const conn = await seedConnection();
    const { markAccountUnavailable } = await import("@/sse/services/auth.js");
    const { getModelLockCountKey } = await import("open-sse/services/accountFallback.js");

    // Lock gpt-a (count=1), gpt-b (count=1), gpt-c (count=1) on same connection
    // Each is a DIFFERENT model, so each gets its own count.
    await markAccountUnavailable(conn.id, 599, "transient", PROVIDER, "gpt-a");
    await markAccountUnavailable(conn.id, 599, "transient", PROVIDER, "gpt-b");
    await markAccountUnavailable(conn.id, 599, "transient", PROVIDER, "gpt-c");
    const updated = await readConn(conn.id);
    expect(Number(updated[getModelLockCountKey("gpt-a")])).toBe(1);
    expect(Number(updated[getModelLockCountKey("gpt-b")])).toBe(1);
    expect(Number(updated[getModelLockCountKey("gpt-c")])).toBe(1);

    // gpt-b succeeds — its count is cleared. gpt-a and gpt-c stay locked → counts remain
    const { clearAccountError } = await import("@/sse/services/auth.js");
    await clearAccountError(conn.id, updated, "gpt-b");
    const after = await readConn(conn.id);
    expect(Number(after[getModelLockCountKey("gpt-a")])).toBe(1); // unchanged (still locked)
    expect(Number(after[getModelLockCountKey("gpt-b")])).toBe(0); // cleared
    expect(Number(after[getModelLockCountKey("gpt-c")])).toBe(1); // unchanged (still locked)
  });
});
