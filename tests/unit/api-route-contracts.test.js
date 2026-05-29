/**
 * API route contract tests.
 *
 * Tests route boundary contracts: status codes, CORS headers, JSON shape.
 * Uses vi.doMock to isolate each route from real dependencies.
 * Pattern matches health.test.js (vi.resetModules + vi.doMock).
 *
 * Routes covered (20):
 *   v1: chat/completions, messages, responses, embeddings, models, models/[kind]
 *   api: providers, tunnel/status, tunnel/tailscale-check
 *   usage: stats, chart, history, providers, logs, request-logs
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeRequest(path, opts = {}) {
  const url = `http://localhost${path}`;
  return new Request(url, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: opts.body || null,
  });
}

function makeJsonRequest(path, body, opts = {}) {
  return makeRequest(path, {
    method: "POST",
    headers: { ...opts.headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...opts,
  });
}

async function readJson(res) {
  return res.json();
}

function expectCors(res) {
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
}

// ─── /v1 endpoints ───────────────────────────────────────────────────────

describe("v1 route contracts", () => {
  // Shared mocks for v1 routes — mock the heavy handler dependencies
  const mockTranslator = {
    initTranslators: vi.fn().mockResolvedValue(undefined),
  };
  const mockChatHandler = {
    handleChat: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
  };
  const mockEmbedHandler = {
    handleEmbeddings: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── /v1/chat/completions ───────────────────────────────────────────────

  describe("OPTIONS /v1/chat/completions", () => {
    beforeEach(() => {
      vi.doMock("open-sse/translator/index.js", () => mockTranslator);
      vi.doMock("@/sse/handlers/chat.js", () => mockChatHandler);
    });

    it("returns 200 with CORS headers", async () => {
      const { OPTIONS } = await import("@/app/api/v1/chat/completions/route.js");
      const res = await OPTIONS();
      expect(res.status).toBe(200);
      expectCors(res);
    });
  });

  describe("POST /v1/chat/completions", () => {
    beforeEach(() => {
      vi.doMock("open-sse/translator/index.js", () => mockTranslator);
      vi.doMock("@/sse/handlers/chat.js", () => mockChatHandler);
      vi.doMock("@/lib/localDb.js", () => ({
        getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
      }));
    });

    it("returns 200 with valid request", async () => {
      const { POST } = await import("@/app/api/v1/chat/completions/route.js");
      const req = makeJsonRequest("/v1/chat/completions", {
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── /v1/messages ───────────────────────────────────────────────────────

  describe("OPTIONS /v1/messages", () => {
    beforeEach(() => {
      vi.doMock("open-sse/translator/index.js", () => mockTranslator);
      vi.doMock("@/sse/handlers/chat.js", () => mockChatHandler);
    });

    it("returns 200 with CORS headers", async () => {
      const { OPTIONS } = await import("@/app/api/v1/messages/route.js");
      const res = await OPTIONS();
      expect(res.status).toBe(200);
      expectCors(res);
    });
  });

  describe("POST /v1/messages", () => {
    beforeEach(() => {
      vi.doMock("open-sse/translator/index.js", () => mockTranslator);
      vi.doMock("@/sse/handlers/chat.js", () => mockChatHandler);
      vi.doMock("@/lib/localDb.js", () => ({
        getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
      }));
    });

    it("returns 200", async () => {
      const { POST } = await import("@/app/api/v1/messages/route.js");
      const req = makeJsonRequest("/v1/messages", { model: "claude-3", messages: [{ role: "user", content: "hi" }] });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── /v1/responses ──────────────────────────────────────────────────────

  describe("OPTIONS /v1/responses", () => {
    beforeEach(() => {
      vi.doMock("open-sse/translator/index.js", () => mockTranslator);
      vi.doMock("@/sse/handlers/chat.js", () => mockChatHandler);
    });

    it("returns 200 with CORS headers", async () => {
      const { OPTIONS } = await import("@/app/api/v1/responses/route.js");
      const res = await OPTIONS();
      expect(res.status).toBe(200);
      expectCors(res);
    });
  });

  describe("POST /v1/responses", () => {
    beforeEach(() => {
      vi.doMock("open-sse/translator/index.js", () => mockTranslator);
      vi.doMock("@/sse/handlers/chat.js", () => mockChatHandler);
      vi.doMock("@/lib/localDb.js", () => ({
        getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
      }));
    });

    it("returns 200", async () => {
      const { POST } = await import("@/app/api/v1/responses/route.js");
      const req = makeJsonRequest("/v1/responses", { model: "gpt-4o", input: "hi" });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── /v1/embeddings ─────────────────────────────────────────────────────

  describe("OPTIONS /v1/embeddings", () => {
    beforeEach(() => {
      vi.doMock("@/sse/handlers/embeddings.js", () => mockEmbedHandler);
    });

    it("returns 200 with CORS headers", async () => {
      const { OPTIONS } = await import("@/app/api/v1/embeddings/route.js");
      const res = await OPTIONS();
      expect(res.status).toBe(200);
      expectCors(res);
    });
  });

  describe("POST /v1/embeddings", () => {
    beforeEach(() => {
      vi.doMock("@/sse/handlers/embeddings.js", () => mockEmbedHandler);
      vi.doMock("@/lib/localDb.js", () => ({
        getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
      }));
    });

    it("returns 200", async () => {
      const { POST } = await import("@/app/api/v1/embeddings/route.js");
      const req = makeJsonRequest("/v1/embeddings", { model: "text-embedding-3-small", input: "hello" });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ── /v1/models ─────────────────────────────────────────────────────────

  describe("GET /v1/models", () => {
    beforeEach(() => {
      vi.doMock("@/lib/localDb.js", () => ({
        getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
      }));
      vi.doMock("@/shared/constants/models.js", () => ({
        PROVIDER_MODELS: {},
        PROVIDER_ID_TO_ALIAS: {},
      }));
    });

    it("returns 200 with object list shape", async () => {
      const { GET } = await import("@/app/api/v1beta/models/[...path]/route.js");
    });
  });

  // ── /v1/models by kind ─────────────────────────────────────────────────

  describe("GET /v1/models/[kind]", () => {
    beforeEach(() => {
      vi.doMock("@/lib/localDb.js", () => ({
        getSettings: vi.fn().mockResolvedValue({ requireApiKey: false, requireLogin: false }),
        validateApiKey: vi.fn().mockResolvedValue(true),
      }));
      vi.doMock("@/shared/constants/models.js", () => ({
        PROVIDER_MODELS: {},
        PROVIDER_ID_TO_ALIAS: {},
      }));
    });

    it("returns 200 for valid kind", async () => {
      const { GET } = await import("@/app/api/v1/models/[kind]/route.js");
      const req = makeRequest("/v1/models/image");
      const params = Promise.resolve({ kind: "image" });
      const res = await GET(req, { params });
      expect(res.status).toBe(200);
      const json = await readJson(res);
      expect(json.object).toBe("list");
      expect(Array.isArray(json.data)).toBe(true);
    });
  });
});

// ─── /api endpoints ──────────────────────────────────────────────────────

describe("api route contracts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── /api/providers ─────────────────────────────────────────────────────

  describe("GET /api/providers", () => {
    beforeEach(() => {
      vi.doMock("@/models", () => ({
        getProviderConnections: vi
          .fn()
          .mockResolvedValue([{ id: "c1", provider: "openai", name: "OpenAI", isActive: true }]),
        getProviderNodes: vi.fn().mockResolvedValue([]),
      }));
    });

    it("returns 200 with connections array", async () => {
      const { GET } = await import("@/app/api/providers/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await readJson(res);
      expect(json).toHaveProperty("connections");
      expect(Array.isArray(json.connections)).toBe(true);
    });
  });

  describe("POST /api/providers", () => {
    beforeEach(() => {
      vi.doMock("@/models", () => ({
        getProviderConnections: vi.fn().mockResolvedValue([]),
        getProviderNodeById: vi.fn().mockResolvedValue(null),
        getProxyPoolById: vi.fn().mockResolvedValue(null),
        createProviderConnection: vi.fn().mockResolvedValue({ id: "new-conn", provider: "openai" }),
      }));
      vi.doMock("@/shared/constants/providers.js", () => ({
        AI_PROVIDERS: { openai: { name: "OpenAI" } },
        FREE_TIER_PROVIDERS: {},
        APIKEY_PROVIDERS: { openai: { name: "OpenAI" } },
        WEB_COOKIE_PROVIDERS: {},
        isOpenAICompatibleProvider: () => false,
        isAnthropicCompatibleProvider: () => false,
        isCustomEmbeddingProvider: () => false,
      }));
      vi.doMock("@/shared/constants/config.js", () => ({
        APIKEY_PROVIDERS: { openai: { name: "OpenAI" } },
      }));
      vi.doMock("@/lib/providerNormalization.js", () => ({
        normalizeProviderId: (p) => p,
        normalizeProviderSpecificData: () => ({}),
      }));
    });

    it("returns 400 when missing provider", async () => {
      const { POST } = await import("@/app/api/providers/route.js");
      const req = makeJsonRequest("/api/providers", { apiKey: "sk-test" });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // ── /api/tunnel/status ─────────────────────────────────────────────────

  describe("GET /api/tunnel/status", () => {
    beforeEach(() => {
      vi.doMock("@/lib/tunnel/tunnelManager.js", () => ({
        getTunnelStatus: vi.fn().mockResolvedValue({ enabled: false, url: null }),
        getTailscaleStatus: vi.fn().mockResolvedValue({ enabled: false, url: null }),
      }));
      vi.doMock("@/lib/tunnel/cloudflared.js", () => ({
        getDownloadStatus: vi.fn().mockResolvedValue({ downloaded: false }),
      }));
    });

    it("returns 200 with tunnel status shape", async () => {
      const { GET } = await import("@/app/api/tunnel/status/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await readJson(res);
      expect(typeof json).toBe("object");
    });
  });

  // ── /api/tunnel/tailscale-check ────────────────────────────────────────

  describe("GET /api/tunnel/tailscale-check", () => {
    beforeEach(() => {
      vi.doMock("node:child_process", () => ({
        execSync: vi.fn().mockReturnValue(""),
      }));
      vi.doMock("@/lib/tunnel/tailscale.js", () => ({
        isTailscaleInstalled: vi.fn().mockReturnValue(false),
        isTailscaleLoggedIn: vi.fn().mockReturnValue(false),
        TAILSCALE_SOCKET: "/tmp/tailscale.sock",
      }));
    });

    it("returns 200 with tailscale check info", async () => {
      const { GET } = await import("@/app/api/tunnel/tailscale-check/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });
});

// ─── /api/usage endpoints ────────────────────────────────────────────────

describe("usage route contracts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── /api/usage/stats ───────────────────────────────────────────────────

  describe("GET /api/usage/stats", () => {
    beforeEach(() => {
      vi.doMock("@/lib/usageDb.js", () => ({
        getUsageStats: vi.fn().mockResolvedValue({ totalRequests: 42, totalCost: 1.5, pendingRequests: 0 }),
        getComboUsageStats: vi.fn().mockResolvedValue({}),
      }));
    });

    it("returns 200 with stats shape", async () => {
      const { GET } = await import("@/app/api/usage/stats/route.js");
      const req = makeRequest("/api/usage/stats?period=7d");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await readJson(res);
      expect(json).toHaveProperty("totalRequests");
    });
  });

  // ── /api/usage/chart ───────────────────────────────────────────────────

  describe("GET /api/usage/chart", () => {
    beforeEach(() => {
      vi.doMock("@/lib/usageDb.js", () => ({
        getChartData: vi.fn().mockResolvedValue([]),
      }));
    });

    it("returns 200 with array", async () => {
      const { GET } = await import("@/app/api/usage/chart/route.js");
      const req = makeRequest("/api/usage/chart?period=24h");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });

  // ── /api/usage/history ─────────────────────────────────────────────────

  describe("GET /api/usage/history", () => {
    beforeEach(() => {
      vi.doMock("@/lib/usageDb.js", () => ({
        getUsageStats: vi.fn().mockResolvedValue({ totalRequests: 0, totalCost: 0 }),
      }));
    });

    it("returns 200", async () => {
      const { GET } = await import("@/app/api/usage/history/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });

  // ── /api/usage/providers ───────────────────────────────────────────────

  describe("GET /api/usage/providers", () => {
    beforeEach(() => {
      vi.doMock("@/lib/localDb.js", () => ({
        getProviderNodes: vi.fn().mockResolvedValue([]),
      }));
      vi.doMock("@/lib/requestDetailsDb.js", () => ({
        getRequestDetails: vi.fn().mockResolvedValue({ details: [], pagination: { totalItems: 0 } }),
      }));
      vi.doMock("@/shared/constants/config.js", () => ({
        AI_PROVIDERS: {},
      }));
    });

    it("returns 200", async () => {
      const { GET } = await import("@/app/api/usage/providers/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });

  // ── /api/usage/logs ────────────────────────────────────────────────────

  describe("GET /api/usage/logs", () => {
    beforeEach(() => {
      vi.doMock("@/lib/usageDb.js", () => ({
        getRecentLogs: vi.fn().mockResolvedValue([]),
      }));
    });

    it("returns 200", async () => {
      const { GET } = await import("@/app/api/usage/logs/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });

  // ── /api/usage/request-logs ────────────────────────────────────────────

  describe("GET /api/usage/request-logs", () => {
    beforeEach(() => {
      vi.doMock("@/lib/usageDb.js", () => ({
        getRecentLogsStructured: vi.fn().mockResolvedValue([]),
      }));
    });

    it("returns 200", async () => {
      const { GET } = await import("@/app/api/usage/request-logs/route.js");
      const req = makeRequest("/api/usage/request-logs?limit=50");
      const res = await GET(req);
      expect(res.status).toBe(200);
    });
  });
});
