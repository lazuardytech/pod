import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-apikey-limit-test-"));
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
});

describe("api key limit config + enforcement", () => {
  it("stores unlimited key by default", async () => {
    const { createApiKey } = await import("@/lib/localDb.js");
    const key = await createApiKey("Default Key", "machine-1");

    expect(key.limitType).toBe("unlimited");
    expect(key.requestsPerMinute).toBeNull();
    expect(key.concurrentRequests).toBeNull();
  });

  it("stores limited key with rpm/concurrency values", async () => {
    const { createApiKey, getApiKeyById } = await import("@/lib/localDb.js");
    const key = await createApiKey("Limited Key", "machine-2", {
      limitType: "limited",
      requestsPerMinute: 120,
      concurrentRequests: 3,
    });

    const saved = await getApiKeyById(key.id);
    expect(saved.limitType).toBe("limited");
    expect(saved.requestsPerMinute).toBe(120);
    expect(saved.concurrentRequests).toBe(3);
  });

  it("enforces requests-per-minute for limited key", async () => {
    const { createApiKey } = await import("@/lib/localDb.js");
    const { withApiKeyRateLimit } = await import("@/lib/rateLimit");

    const key = await createApiKey("RPM Key", "machine-3", {
      limitType: "limited",
      requestsPerMinute: 2,
      concurrentRequests: 5,
    });

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.key}` },
    });

    const okHandler = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const r1 = await withApiKeyRateLimit(req, okHandler);
    const r2 = await withApiKeyRateLimit(req, okHandler);
    const r3 = await withApiKeyRateLimit(req, okHandler);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get("retry-after")).toBeTruthy();
  });

  it("enforces concurrent requests while streaming response is still active", async () => {
    const { createApiKey } = await import("@/lib/localDb.js");
    const { withApiKeyRateLimit } = await import("@/lib/rateLimit");

    const key = await createApiKey("Concurrent Key", "machine-4", {
      limitType: "limited",
      requestsPerMinute: 100,
      concurrentRequests: 1,
    });

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key.key}` },
    });

    const streamHandler = async () =>
      new Response(new ReadableStream(), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

    const first = await withApiKeyRateLimit(req, streamHandler);
    const secondWhileActive = await withApiKeyRateLimit(req, streamHandler);

    expect(first.status).toBe(200);
    expect(secondWhileActive.status).toBe(429);

    // Cancel first stream to release concurrency slot, then retry.
    await first.body.cancel();
    const thirdAfterCancel = await withApiKeyRateLimit(req, streamHandler);
    expect(thirdAfterCancel.status).toBe(200);
    await thirdAfterCancel.body.cancel();
  });
});
