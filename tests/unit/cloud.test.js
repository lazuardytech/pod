/**
 * Unit tests for cloud/ directory
 *
 * Covers:
 *  - testClaude stub → 410
 *  - apiKey utils: parseApiKey, extractBearerToken
 *  - storage: getMachineData, saveMachineData, deleteMachineData
 *  - sync handler: GET, DELETE, POST merge logic
 *  - cleanup handler: deletes old rows, returns count
 *  - verify handler: missing auth, valid key
 *  - index router: /, /health, OPTIONS, unknown path, /testClaude
 *
 * Strategy: mock all external deps (D1, open-sse, storage, logger)
 * so tests run without Cloudflare Workers runtime.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("../../cloud/src/utils/logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  request: vi.fn(),
  response: vi.fn(),
}));

vi.mock("../../cloud/src/services/storage.js", () => ({
  getMachineData: vi.fn(),
  saveMachineData: vi.fn(),
  deleteMachineData: vi.fn(),
  updateMachineProvider: vi.fn(),
}));

vi.mock("../../cloud/src/utils/apiKey.js", () => ({
  parseApiKey: vi.fn(),
  extractBearerToken: vi.fn(),
}));

// open-sse stubs so index.js can be imported without the real module
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));
vi.mock("open-sse/config/ollamaModels.js", () => ({ ollamaModels: { models: [] } }));
vi.mock("open-sse/utils/ollamaTransform.js", () => ({ transformToOllama: vi.fn((r) => r) }));

vi.mock("../../cloud/src/handlers/chat.js", () => ({ handleChat: vi.fn() }));
vi.mock("../../cloud/src/handlers/embeddings.js", () => ({ handleEmbeddings: vi.fn() }));
vi.mock("../../cloud/src/handlers/forward.js", () => ({ handleForward: vi.fn() }));
vi.mock("../../cloud/src/handlers/forwardRaw.js", () => ({ handleForwardRaw: vi.fn() }));
vi.mock("../../cloud/src/handlers/cache.js", () => ({ handleCacheClear: vi.fn() }));
vi.mock("../../cloud/src/services/landingPage.js", () => ({
  createLandingPageResponse: vi.fn(
    () =>
      new Response("<html>Pod</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  ),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { handleCleanup } from "../../cloud/src/handlers/cleanup.js";
import { handleSync } from "../../cloud/src/handlers/sync.js";
import { handleTestClaude } from "../../cloud/src/handlers/testClaude.js";
import { handleVerify } from "../../cloud/src/handlers/verify.js";
import worker from "../../cloud/src/index.js";
import { deleteMachineData, getMachineData, saveMachineData } from "../../cloud/src/services/storage.js";
import { extractBearerToken, parseApiKey } from "../../cloud/src/utils/apiKey.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MACHINE_ID = "mach01";
const VALID_KEY = "sk-mach01-key01-ab12cd34";

function makeEnv() {
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    })),
  }));
  return { DB: { prepare }, CLOUD_SYNC_SECRET: "test-secret" };
}

function makeMachineData(overrides = {}) {
  return {
    machineId: MACHINE_ID,
    apiKeys: [{ key: VALID_KEY, label: "test" }],
    providers: {
      "conn-001": {
        provider: "openai",
        apiKey: "sk-openai-key",
        isActive: true,
        priority: 1,
        status: "active",
        rateLimitedUntil: null,
        lastError: null,
        updatedAt: new Date().toISOString(),
      },
    },
    modelAliases: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(method, path, body = null, authHeader = `Bearer ${VALID_KEY}`, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (authHeader) headers["Authorization"] = authHeader;
  return new Request(`https://worker.example.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Helper for sync requests (requires x-pod-cloud-secret)
function makeSyncRequest(method, path, body = null) {
  return makeRequest(method, path, body, null, { "x-pod-cloud-secret": "test-secret" });
}

// ─── 1. testClaude stub ───────────────────────────────────────────────────────

describe("handleTestClaude — stub", () => {
  it("returns 410 with deprecation message", async () => {
    const req = new Request("https://worker.example.com/testClaude", { method: "POST" });
    const res = await handleTestClaude(req);

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/deprecated/i);
    expect(body.error).toMatch(/\/v1\/messages/i);
  });

  it("Content-Type is application/json", async () => {
    const req = new Request("https://worker.example.com/testClaude", { method: "POST" });
    const res = await handleTestClaude(req);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

// ─── 2. apiKey utils ──────────────────────────────────────────────────────────

describe("parseApiKey", () => {
  afterEach(() => vi.clearAllMocks());

  it("new format sk-{machineId}-{keyId}-{crc8} → isNewFormat true with machineId and keyId", async () => {
    vi.mocked(parseApiKey).mockResolvedValue({
      isNewFormat: true,
      machineId: "mach01",
      keyId: "key01",
    });

    const result = await parseApiKey("sk-mach01-key01-ab12cd34");
    expect(result).toEqual({ isNewFormat: true, machineId: "mach01", keyId: "key01" });
  });

  it("old format sk-{random8} → isNewFormat false", async () => {
    vi.mocked(parseApiKey).mockResolvedValue({ isNewFormat: false, machineId: null, keyId: "random8x" });

    const result = await parseApiKey("sk-random8x");
    expect(result).toEqual({ isNewFormat: false, machineId: null, keyId: "random8x" });
  });

  it("null input → returns null", async () => {
    vi.mocked(parseApiKey).mockResolvedValue(null);

    const result = await parseApiKey(null);
    expect(result).toBeNull();
  });

  it("empty string → returns null", async () => {
    vi.mocked(parseApiKey).mockResolvedValue(null);

    const result = await parseApiKey("");
    expect(result).toBeNull();
  });

  it("key without sk- prefix → returns null", async () => {
    vi.mocked(parseApiKey).mockResolvedValue(null);

    const result = await parseApiKey("notakey");
    expect(result).toBeNull();
  });
});

describe("extractBearerToken", () => {
  afterEach(() => vi.clearAllMocks());

  it("extracts token from Authorization: Bearer sk-xxx", () => {
    vi.mocked(extractBearerToken).mockReturnValue("sk-mach01-key01-ab12cd34");

    const req = new Request("https://x.com", {
      headers: { Authorization: "Bearer sk-mach01-key01-ab12cd34" },
    });
    const token = extractBearerToken(req);
    expect(token).toBe("sk-mach01-key01-ab12cd34");
  });

  it("returns null when no Authorization header", () => {
    vi.mocked(extractBearerToken).mockReturnValue(null);

    const req = new Request("https://x.com");
    const token = extractBearerToken(req);
    expect(token).toBeNull();
  });

  it("returns null for non-Bearer scheme", () => {
    vi.mocked(extractBearerToken).mockReturnValue(null);

    const req = new Request("https://x.com", {
      headers: { Authorization: "Token abc123" },
    });
    const token = extractBearerToken(req);
    expect(token).toBeNull();
  });
});

// ─── 3. storage ───────────────────────────────────────────────────────────────

describe("getMachineData", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns null when D1 returns no rows", async () => {
    vi.mocked(getMachineData).mockResolvedValue(null);

    const env = makeEnv();
    const result = await getMachineData("nonexistent", env);
    expect(result).toBeNull();
  });

  it("parses and returns JSON data from D1 row", async () => {
    const data = makeMachineData();
    vi.mocked(getMachineData).mockResolvedValue(data);

    const env = makeEnv();
    const result = await getMachineData(MACHINE_ID, env);
    expect(result).toEqual(data);
    expect(result.machineId).toBe(MACHINE_ID);
    expect(result.providers).toBeDefined();
  });
});

describe("saveMachineData", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls D1 prepare with INSERT ... ON CONFLICT upsert SQL", async () => {
    vi.mocked(saveMachineData).mockResolvedValue(undefined);

    const env = makeEnv();
    const data = makeMachineData();
    await saveMachineData(MACHINE_ID, data, env);

    expect(saveMachineData).toHaveBeenCalledWith(MACHINE_ID, data, env);
  });

  it("resolves without error on success", async () => {
    vi.mocked(saveMachineData).mockResolvedValue(undefined);

    const env = makeEnv();
    await expect(saveMachineData(MACHINE_ID, makeMachineData(), env)).resolves.toBeUndefined();
  });
});

describe("deleteMachineData", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls D1 prepare with DELETE SQL", async () => {
    vi.mocked(deleteMachineData).mockResolvedValue(undefined);

    const env = makeEnv();
    await deleteMachineData(MACHINE_ID, env);

    expect(deleteMachineData).toHaveBeenCalledWith(MACHINE_ID, env);
  });

  it("resolves without error on success", async () => {
    vi.mocked(deleteMachineData).mockResolvedValue(undefined);

    const env = makeEnv();
    await expect(deleteMachineData(MACHINE_ID, env)).resolves.toBeUndefined();
  });
});

// ─── 4. sync handler ──────────────────────────────────────────────────────────

describe("handleSync — GET", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns machine data when found", async () => {
    const data = makeMachineData();
    vi.mocked(getMachineData).mockResolvedValue(data);

    const req = makeSyncRequest("GET", `/sync/${MACHINE_ID}`);
    const res = await handleSync(req, makeEnv(), {});

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.machineId).toBe(MACHINE_ID);
  });

  it("returns 404 when machine not found", async () => {
    vi.mocked(getMachineData).mockResolvedValue(null);

    const req = makeSyncRequest("GET", "/sync/unknown");
    const res = await handleSync(req, makeEnv(), {});

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no data found/i);
  });
});

describe("handleSync — DELETE", () => {
  afterEach(() => vi.clearAllMocks());

  it("deletes machine data and returns success", async () => {
    vi.mocked(deleteMachineData).mockResolvedValue(undefined);

    const req = makeSyncRequest("DELETE", `/sync/${MACHINE_ID}`);
    const res = await handleSync(req, makeEnv(), {});

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(deleteMachineData).toHaveBeenCalledWith(MACHINE_ID, expect.anything());
  });
});

describe("handleSync — POST merge", () => {
  afterEach(() => vi.clearAllMocks());

  it("merges providers: web provider with newer updatedAt wins", async () => {
    const olderTime = new Date(Date.now() - 10000).toISOString();
    const newerTime = new Date().toISOString();

    vi.mocked(getMachineData).mockResolvedValue(
      makeMachineData({
        providers: {
          "conn-001": {
            id: "conn-001",
            provider: "openai",
            apiKey: "sk-old",
            isActive: true,
            priority: 1,
            status: "active",
            updatedAt: olderTime,
          },
        },
      }),
    );
    vi.mocked(saveMachineData).mockResolvedValue(undefined);

    const req = makeSyncRequest("POST", `/sync/${MACHINE_ID}`, {
      providers: [
        {
          id: "conn-001",
          provider: "openai",
          apiKey: "sk-new",
          isActive: true,
          priority: 1,
          status: "active",
          updatedAt: newerTime,
        },
      ],
      modelAliases: {},
      apiKeys: [{ key: VALID_KEY }],
    });

    const res = await handleSync(req, makeEnv(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.providers["conn-001"].apiKey).toBe("sk-new");
  });

  it("merges providers: worker provider with newer updatedAt wins", async () => {
    const newerTime = new Date().toISOString();
    const olderTime = new Date(Date.now() - 10000).toISOString();

    vi.mocked(getMachineData).mockResolvedValue(
      makeMachineData({
        providers: {
          "conn-001": {
            id: "conn-001",
            provider: "openai",
            apiKey: "sk-worker-newer",
            isActive: true,
            priority: 1,
            status: "active",
            updatedAt: newerTime,
          },
        },
      }),
    );
    vi.mocked(saveMachineData).mockResolvedValue(undefined);

    const req = makeSyncRequest("POST", `/sync/${MACHINE_ID}`, {
      providers: [
        {
          id: "conn-001",
          provider: "openai",
          apiKey: "sk-web-older",
          isActive: true,
          priority: 1,
          status: "active",
          updatedAt: olderTime,
        },
      ],
      modelAliases: {},
      apiKeys: [{ key: VALID_KEY }],
    });

    const res = await handleSync(req, makeEnv(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.providers["conn-001"].apiKey).toBe("sk-worker-newer");
  });

  it("returns 400 when providers field is missing", async () => {
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());

    const req = makeSyncRequest("POST", `/sync/${MACHINE_ID}`, { modelAliases: {} });
    const res = await handleSync(req, makeEnv(), {});

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/providers/i);
  });

  it("returns 400 on invalid JSON body", async () => {
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());

    const req = new Request(`https://worker.example.com/sync/${MACHINE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pod-cloud-secret": "test-secret" },
      body: "{ bad json",
    });
    const res = await handleSync(req, makeEnv(), {});

    expect(res.status).toBe(400);
  });
});

// ─── 5. cleanup handler ───────────────────────────────────────────────────────

describe("handleCleanup", () => {
  afterEach(() => vi.clearAllMocks());

  it("deletes rows older than 7 days and returns deleted count", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ meta: { changes: 3 } }),
          })),
        })),
      },
    };

    const result = await handleCleanup(env);

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(3);
    expect(result.cutoffDate).toBeDefined();
  });

  it("cutoffDate is approximately 7 days ago", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
          })),
        })),
      },
    };

    const before = Date.now();
    const result = await handleCleanup(env);
    const after = Date.now();

    const cutoff = new Date(result.cutoffDate).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(cutoff).toBeGreaterThanOrEqual(before - sevenDaysMs - 1000);
    expect(cutoff).toBeLessThanOrEqual(after - sevenDaysMs + 1000);
  });

  it("returns deleted: 0 when no old rows exist", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
          })),
        })),
      },
    };

    const result = await handleCleanup(env);
    expect(result.deleted).toBe(0);
  });

  it("returns success: false on DB error", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockRejectedValue(new Error("D1 error")),
          })),
        })),
      },
    };

    const result = await handleCleanup(env);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/D1 error/);
  });
});

// ─── 6. verify handler ────────────────────────────────────────────────────────

describe("handleVerify", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns { valid: false } shape (401) when no Authorization header", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(null);

    const req = new Request("https://worker.example.com/v1/verify", { method: "GET" });
    const res = await handleVerify(req, makeEnv(), null);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 401 when API key format is invalid", async () => {
    vi.mocked(extractBearerToken).mockReturnValue("sk-badkey");
    vi.mocked(parseApiKey).mockResolvedValue(null);

    const req = makeRequest("GET", "/v1/verify");
    const res = await handleVerify(req, makeEnv(), null);

    expect(res.status).toBe(401);
  });

  it("returns { valid: true, machineId, providersCount } for valid key", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({
      isNewFormat: true,
      machineId: MACHINE_ID,
      keyId: "key01",
    });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());

    const req = makeRequest("GET", "/v1/verify");
    const res = await handleVerify(req, makeEnv(), null);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.machineId).toBe(MACHINE_ID);
    expect(typeof body.providersCount).toBe("number");
    expect(body.providersCount).toBe(1);
  });

  it("returns 401 when key not in machine apiKeys", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({
      isNewFormat: true,
      machineId: MACHINE_ID,
      keyId: "key01",
    });
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData({ apiKeys: [{ key: "sk-different-key" }] }));

    const req = makeRequest("GET", "/v1/verify");
    const res = await handleVerify(req, makeEnv(), null);

    expect(res.status).toBe(401);
  });

  it("returns 404 when machine not found", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_KEY);
    vi.mocked(parseApiKey).mockResolvedValue({
      isNewFormat: true,
      machineId: MACHINE_ID,
      keyId: "key01",
    });
    vi.mocked(getMachineData).mockResolvedValue(null);

    const req = makeRequest("GET", "/v1/verify");
    const res = await handleVerify(req, makeEnv(), null);

    expect(res.status).toBe(404);
  });

  it("machineIdOverride skips parseApiKey, uses override directly", async () => {
    vi.mocked(extractBearerToken).mockReturnValue(VALID_KEY);
    vi.mocked(getMachineData).mockResolvedValue(makeMachineData());

    const req = makeRequest("GET", `/${MACHINE_ID}/v1/verify`);
    const res = await handleVerify(req, makeEnv(), MACHINE_ID);

    expect(res.status).toBe(200);
    // parseApiKey should NOT have been called since machineIdOverride was provided
    expect(parseApiKey).not.toHaveBeenCalled();
  });
});

// ─── 7. index router ──────────────────────────────────────────────────────────

describe("worker index router", () => {
  const env = makeEnv();
  const ctx = {};

  afterEach(() => vi.clearAllMocks());

  it("GET / returns 200 HTML landing page", async () => {
    const req = new Request("https://worker.example.com/", { method: "GET" });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
  });

  it("GET /health returns { status: 'ok' }", async () => {
    const req = new Request("https://worker.example.com/health", { method: "GET" });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("OPTIONS returns CORS headers", async () => {
    const req = new Request("https://worker.example.com/v1/chat/completions", {
      method: "OPTIONS",
    });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
  });

  it("unknown path returns 404", async () => {
    const req = new Request("https://worker.example.com/no-such-route", { method: "GET" });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("POST /testClaude returns 410 with deprecation message", async () => {
    const req = new Request("https://worker.example.com/testClaude", { method: "POST" });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/deprecated/i);
  });

  it("/v1/v1/chat/completions normalizes to /v1/chat/completions", async () => {
    const { handleChat } = await import("../../cloud/src/handlers/chat.js");
    vi.mocked(handleChat).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const req = new Request("https://worker.example.com/v1/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await worker.fetch(req, env, ctx);

    expect(handleChat).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});
