import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock all external modules before imports
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(() => Promise.resolve([])),
  getCombos: vi.fn(() => Promise.resolve([])),
  getApiKeys: vi.fn(() => Promise.resolve([])),
  getSettings: vi.fn(() => Promise.resolve({})),
  getProviderNodes: vi.fn(() => Promise.resolve([])),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/sqlite/connection.ts", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ integrity_check: "ok", value: "1" })),
      run: vi.fn(),
      all: vi.fn(() => []),
    })),
  })),
}));

vi.mock("@/lib/semanticCache.js", () => ({
  getCacheStats: vi.fn(() => ({
    memoryEntries: 5,
    dbEntries: 10,
    hits: 100,
    misses: 20,
    hitRate: "83.3",
    tokensSaved: 5000,
  })),
  getInFlightStats: vi.fn(() => ({ count: 3 })),
}));

vi.mock("@/lib/cacheLayer.js", () => ({
  LRUCache: vi.fn(),
  getPromptCache: vi.fn(() => ({
    getStats: vi.fn(() => ({
      size: 8,
      maxSize: 50,
      bytes: 512000,
      maxBytes: 2097152,
      hits: 42,
      misses: 10,
      hitRate: 80.8,
      evictions: 2,
    })),
  })),
}));

vi.mock("@/lib/usageDb.js", () => ({
  getQueueDepths: vi.fn(() => ({ logQueue: 0, summaryQueue: 0 })),
  getPendingStats: vi.fn(() => ({ total: 5, byProvider: { openai: 3, anthropic: 2 } })),
  getConnectionNameCacheStats: vi.fn(() => ({
    size: 12,
    maxSize: 500,
    bytes: 2048,
    maxBytes: 4194304,
    hits: 30,
    misses: 5,
    hitRate: 85.7,
    evictions: 0,
  })),
}));

vi.mock("@/lib/memory/store.js", () => ({
  getMemoryStoreStats: vi.fn(() => ({
    size: 20,
    maxSize: 500,
    bytes: 819200,
    maxBytes: 4194304,
    hits: 50,
    misses: 10,
    hitRate: 83.3,
    evictions: 1,
  })),
}));

vi.mock("@/lib/modelsDevSync.js", () => ({
  getSyncStatus: vi.fn(() => ({
    lastSync: "2026-05-28T00:00:00.000Z",
    lastSyncModelCount: 350,
    nextSync: "2026-05-28T01:00:00.000Z",
    intervalMs: 3600000,
  })),
}));

vi.mock("@/shared/services/cloudSyncScheduler", () => ({
  getCloudSyncStatus: vi.fn(() => ({
    enabled: false,
    isRunning: false,
    lastSyncAt: null,
  })),
}));

vi.mock("@/shared/constants/config", () => ({
  APP_CONFIG: {
    displayVersion: "0.0.63",
  },
  displayVersion: "0.0.63",
}));

vi.mock("@/shared/constants/providers.js", () => ({
  AI_PROVIDERS: {},
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
  isCustomEmbeddingProvider: vi.fn(() => false),
}));

vi.mock("node:fs", () => ({
  default: {
    statSync: vi.fn(() => ({ size: 1048576 })),
  },
}));

import { buildHealthPayload } from "@/app/api/monitoring/health/_health.js";
import { GET } from "@/app/api/monitoring/health/route.js";
import { getSettings } from "@/lib/localDb";

describe("buildHealthPayload", () => {
  it("returns all expected top-level keys", async () => {
    const payload = await buildHealthPayload();

    expect(payload).toHaveProperty("status");
    expect(payload).toHaveProperty("timestamp");
    expect(payload).toHaveProperty("version");
    expect(payload).toHaveProperty("system");
    expect(payload).toHaveProperty("runtime");
    expect(payload).toHaveProperty("database");
    expect(payload).toHaveProperty("providers");
    expect(payload).toHaveProperty("tunnel");
    expect(payload).toHaveProperty("caches");
    expect(payload).toHaveProperty("inFlight");
    expect(payload).toHaveProperty("pending");
    expect(payload).toHaveProperty("sync");
    expect(payload).toHaveProperty("queueDepths");
    expect(payload).toHaveProperty("providerHealth");
    expect(payload).toHaveProperty("rateLimitStatus");
    expect(payload).toHaveProperty("blockedModelStatus");
  });

  it("includes version info", async () => {
    const payload = await buildHealthPayload();
    expect(payload.version).toEqual({
      pod: "0.0.63",
      bun: null,
      node: process.version,
    });
  });

  it("includes runtime with humanized memory", async () => {
    const payload = await buildHealthPayload();
    expect(payload.runtime).toHaveProperty("memoryUsageHumanized");
    expect(payload.runtime).toHaveProperty("memoryPressure");
    expect(payload.runtime).toHaveProperty("memoryPressurePercent");
    expect(payload.runtime).toHaveProperty("dataDirSizeBytes");
    expect(payload.runtime).toHaveProperty("processStartedAt");
    expect(payload.runtime).toHaveProperty("dataDir");
    // Humanized values should be strings
    expect(typeof payload.runtime.memoryUsageHumanized.rss).toBe("string");
    expect(typeof payload.runtime.memoryUsageHumanized.heapUsed).toBe("string");
    expect(typeof payload.runtime.memoryUsageHumanized.heapTotal).toBe("string");
  });

  it("memoryPressure is bounded 0..1", async () => {
    const payload = await buildHealthPayload();
    expect(payload.runtime.memoryPressure).toBeGreaterThanOrEqual(0);
    expect(payload.runtime.memoryPressure).toBeLessThanOrEqual(1);
  });

  it("includes caches stats with all 4 layers", async () => {
    const payload = await buildHealthPayload();
    expect(payload.caches).toHaveProperty("semanticCache");
    expect(payload.caches).toHaveProperty("promptCache");
    expect(payload.caches).toHaveProperty("memoryStore");
    expect(payload.caches).toHaveProperty("connectionNameCache");
  });

  it("includes inFlight dedup count", async () => {
    const payload = await buildHealthPayload();
    expect(payload.inFlight).toHaveProperty("count");
    expect(payload.inFlight.count).toBe(3);
  });

  it("includes pending request stats", async () => {
    const payload = await buildHealthPayload();
    expect(payload.pending).toHaveProperty("total");
    expect(payload.pending).toHaveProperty("byProvider");
  });

  it("includes sync status", async () => {
    const payload = await buildHealthPayload();
    expect(payload.sync).toHaveProperty("modelsDev");
    expect(payload.sync).toHaveProperty("cloud");
    expect(payload.sync.modelsDev).toHaveProperty("enabled");
    expect(payload.sync.modelsDev).toHaveProperty("intervalHours");
    expect(payload.sync.modelsDev).toHaveProperty("lastSyncAt");
    expect(payload.sync.modelsDev).toHaveProperty("lastSyncOk");
  });

  it("includes providers byStatus and byProvider", async () => {
    const payload = await buildHealthPayload();
    expect(payload.providers).toHaveProperty("byStatus");
    expect(payload.providers).toHaveProperty("byProvider");
    expect(payload.providers.byStatus).toHaveProperty("active");
    expect(payload.providers.byStatus).toHaveProperty("error");
    expect(payload.providers.byStatus).toHaveProperty("untested");
    expect(payload.providers.byStatus).toHaveProperty("rateLimited");
    expect(payload.providers.byStatus).toHaveProperty("modelLocked");
  });
});

describe("health endpoint is public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 without any auth header (requireApiKey=true)", async () => {
    vi.mocked(getSettings).mockResolvedValue({ requireApiKey: true, requireLogin: true });
    const request = new Request("http://localhost/api/monitoring/health");
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("version");
  });

  it("returns 200 with an invalid key (public, no auth check)", async () => {
    vi.mocked(getSettings).mockResolvedValue({ requireApiKey: true, requireLogin: true });
    const request = new Request("http://localhost/api/monitoring/health", {
      headers: { Authorization: "Bearer invalid-key" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it("returns 200 when requireApiKey=true and valid key", async () => {
    vi.mocked(getSettings).mockResolvedValue({ requireApiKey: true, requireLogin: true });
    const request = new Request("http://localhost/api/monitoring/health", {
      headers: { Authorization: "Bearer valid-key" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("status");
  });

  it("returns 200 when requireApiKey=false and requireLogin=false (fully public)", async () => {
    vi.mocked(getSettings).mockResolvedValue({ requireApiKey: false, requireLogin: false });
    const request = new Request("http://localhost/api/monitoring/health");
    const response = await GET(request);
    expect(response.status).toBe(200);
  });
});
