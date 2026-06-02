/**
 * Unit + Integration tests for /api/monitoring/health
 *
 * Unit tests: pure logic helpers (formatBytes, formatUptime, getSystemInfo shape)
 * Integration tests: actual API route handler with mocked dependencies
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_CONFIG } from "@/shared/constants/config.js";

// ─── Helpers (duplicated from page/route for isolated testing) ────────────────

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds = 0) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Unit: formatBytes ────────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("formats bytes", () => expect(formatBytes(512)).toBe("512 B"));
  it("formats KB", () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("formats MB", () => expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB"));
  it("formats GB", () => expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB"));
  it("defaults to 0 B", () => expect(formatBytes()).toBe("0 B"));
  it("handles exact 1 KB boundary", () => expect(formatBytes(1024)).toBe("1.0 KB"));
});

// ─── Unit: formatUptime ───────────────────────────────────────────────────────

describe("formatUptime", () => {
  it("formats minutes only", () => expect(formatUptime(300)).toBe("5m"));
  it("formats hours and minutes", () => expect(formatUptime(3900)).toBe("1h 5m"));
  it("formats days hours minutes", () => expect(formatUptime(90061)).toBe("1d 1h 1m"));
  it("defaults to 0m", () => expect(formatUptime(0)).toBe("0m"));
  it("formats exactly 1 hour", () => expect(formatUptime(3600)).toBe("1h 0m"));
  it("formats exactly 1 day", () => expect(formatUptime(86400)).toBe("1d 0h 0m"));
});

// ─── Unit: health status logic ────────────────────────────────────────────────

describe("health status derivation", () => {
  function deriveStatus(database) {
    return database.ok && database.integrity === "ok" ? "healthy" : "issues";
  }

  it("returns healthy when db ok and integrity ok", () => {
    expect(deriveStatus({ ok: true, integrity: "ok" })).toBe("healthy");
  });

  it("returns issues when db not ok", () => {
    expect(deriveStatus({ ok: false, integrity: "ok" })).toBe("issues");
  });

  it("returns issues when integrity check fails", () => {
    expect(deriveStatus({ ok: true, integrity: "corruption found" })).toBe("issues");
  });

  it("returns issues when both fail", () => {
    expect(deriveStatus({ ok: false, integrity: "error" })).toBe("issues");
  });
});

// ─── Unit: system info shape ──────────────────────────────────────────────────

describe("system info shape", () => {
  it("process.memoryUsage returns expected keys", () => {
    const mem = process.memoryUsage();
    expect(mem).toHaveProperty("rss");
    expect(mem).toHaveProperty("heapUsed");
    expect(mem).toHaveProperty("heapTotal");
    expect(typeof mem.rss).toBe("number");
    expect(mem.rss).toBeGreaterThan(0);
  });

  it("process.version is a valid semver string", () => {
    expect(process.version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("process.platform is a non-empty string", () => {
    expect(typeof process.platform).toBe("string");
    expect(process.platform.length).toBeGreaterThan(0);
  });

  it("os.cpus returns an array with at least 1 cpu", async () => {
    const os = await import("node:os");
    expect(Array.isArray(os.cpus())).toBe(true);
    expect(os.cpus().length).toBeGreaterThan(0);
  });

  it("os.freemem is a positive number", async () => {
    const os = await import("node:os");
    expect(os.freemem()).toBeGreaterThan(0);
  });

  it("os.totalmem is greater than freemem", async () => {
    const os = await import("node:os");
    expect(os.totalmem()).toBeGreaterThanOrEqual(os.freemem());
  });
});

// ─── Integration: GET /api/monitoring/health ─────────────────────────────────

describe("GET /api/monitoring/health (integration)", () => {
  let GET;

  beforeEach(async () => {
    vi.resetModules();

    // Mock SQLite connection
    vi.doMock("@/lib/sqlite/connection.js", () => ({
      getDatabase: () => ({
        prepare: (sql) => ({
          get: () => {
            if (sql.includes("schema_version")) return { value: "1" };
            if (sql.includes("integrity_check")) return { integrity_check: "ok" };
            if (sql.includes("page_count")) return { page_count: 100 };
            if (sql.includes("page_size")) return { page_size: 4096 };
            if (sql.includes("journal_mode")) return { journal_mode: "wal" };
            return null;
          },
        }),
      }),
    }));

    // Mock localDb functions
    vi.doMock("@/lib/localDb.js", () => ({
      getProviderConnections: async () => [
        { id: "conn-1", provider: "openai", enabled: true },
        { id: "conn-2", provider: "anthropic", enabled: false },
        { id: "conn-3", provider: "gemini", enabled: true },
      ],
      getCombos: async () => [{ id: "combo-1", name: "fallback-combo" }],
      getApiKeys: async () => [
        { id: "key-1", key: "sk-test" },
        { id: "key-2", key: "sk-test-2" },
      ],
      getSettings: async () => ({
        requireApiKey: false,
        requireLogin: false,
        tunnelEnabled: true,
        tunnelUrl: "https://test.trycloudflare.com",
        tailscaleEnabled: false,
        tailscaleUrl: "",
        semanticCacheEnabled: true,
        semanticCacheMaxSize: 100,
        semanticCacheTTL: 1800000,
      }),
      getProviderNodes: async () => [],
    }));

    const mod = await import("@/app/api/monitoring/health/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with valid JSON", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toBeDefined();
  });

  it("response has required top-level keys", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("timestamp");
    expect(json).toHaveProperty("system");
    expect(json).toHaveProperty("database");
    expect(json).toHaveProperty("providers");
    expect(json).toHaveProperty("tunnel");
    expect(json).toHaveProperty("semanticCache");
  });

  it("returns configured pod display version in payload.version.pod", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.version?.pod).toBe(APP_CONFIG.displayVersion);
  });

  it("status is healthy when db integrity is ok", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.status).toBe("healthy");
  });

  it("timestamp is a recent unix ms", async () => {
    const before = Date.now();
    const res = await GET();
    const after = Date.now();
    const json = await res.json();
    expect(json.timestamp).toBeGreaterThanOrEqual(before);
    expect(json.timestamp).toBeLessThanOrEqual(after);
  });

  it("system info has expected shape", async () => {
    const res = await GET();
    const { system } = await res.json();
    expect(typeof system.uptime).toBe("number");
    expect(system.uptime).toBeGreaterThanOrEqual(0);
    expect(system.nodeVersion).toMatch(/^v\d+/);
    expect(typeof system.platform).toBe("string");
    expect(typeof system.arch).toBe("string");
    expect(system.memoryUsage).toHaveProperty("rss");
    expect(system.memoryUsage).toHaveProperty("heapUsed");
    expect(system.memoryUsage).toHaveProperty("heapTotal");
    expect(system.memoryUsage.rss).toBeGreaterThan(0);
    expect(typeof system.cpus).toBe("number");
    expect(system.cpus).toBeGreaterThan(0);
    expect(typeof system.freeMemory).toBe("number");
    expect(typeof system.totalMemory).toBe("number");
  });

  it("database info reflects mocked SQLite", async () => {
    const res = await GET();
    const { database } = await res.json();
    expect(database.ok).toBe(true);
    expect(database.schemaVersion).toBe("1");
    expect(database.integrity).toBe("ok");
    expect(database.sizeBytes).toBe(100 * 4096);
    expect(database.journalMode).toBe("wal");
  });

  it("providers counts are correct", async () => {
    const res = await GET();
    const { providers } = await res.json();
    expect(providers.total).toBe(3);
    expect(providers.enabled).toBe(2); // conn-1 and conn-3 are enabled
    expect(providers.combos).toBe(1);
    expect(providers.apiKeys).toBe(2);
  });

  it("tunnel reflects settings", async () => {
    const res = await GET();
    const { tunnel } = await res.json();
    expect(tunnel.cloudflareEnabled).toBe(true);
    expect(tunnel.cloudflareUrl).toBe("https://test.trycloudflare.com");
    expect(tunnel.tailscaleEnabled).toBe(false);
    expect(tunnel.tailscaleUrl).toBe("");
  });

  it("semanticCache reflects settings", async () => {
    const res = await GET();
    const { semanticCache } = await res.json();
    expect(semanticCache.enabled).toBe(true);
    expect(semanticCache.maxSize).toBe(100);
    expect(semanticCache.ttlMs).toBe(1800000);
  });
});

// ─── Integration: degraded DB ─────────────────────────────────────────────────

describe("GET /api/monitoring/health — degraded DB", () => {
  let GET;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/lib/sqlite/connection.js", () => ({
      getDatabase: () => ({
        prepare: (sql) => ({
          get: () => {
            if (sql.includes("integrity_check")) return { integrity_check: "corruption found in page 42" };
            if (sql.includes("schema_version")) return { value: "1" };
            if (sql.includes("page_count")) return { page_count: 50 };
            if (sql.includes("page_size")) return { page_size: 4096 };
            if (sql.includes("journal_mode")) return { journal_mode: "wal" };
            return null;
          },
        }),
      }),
    }));

    vi.doMock("@/lib/localDb.js", () => ({
      getProviderConnections: async () => [],
      getCombos: async () => [],
      getApiKeys: async () => [],
      getSettings: async () => ({ requireApiKey: false, requireLogin: false }),
      getProviderNodes: async () => [],
    }));

    const mod = await import("@/app/api/monitoring/health/route.js");
    GET = mod.GET;
  });

  afterEach(() => vi.restoreAllMocks());

  it("status is issues when integrity check fails", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.status).toBe("issues");
    expect(json.database.integrity).toBe("corruption found in page 42");
  });
});

// ─── Integration: SQLite throws ───────────────────────────────────────────────

describe("GET /api/monitoring/health — SQLite unavailable", () => {
  let GET;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/lib/sqlite/connection.js", () => ({
      getDatabase: () => {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      },
    }));

    vi.doMock("@/lib/localDb.js", () => ({
      getProviderConnections: async () => [],
      getCombos: async () => [],
      getApiKeys: async () => [],
      getSettings: async () => ({ requireApiKey: false, requireLogin: false }),
      getProviderNodes: async () => [],
    }));

    const mod = await import("@/app/api/monitoring/health/route.js");
    GET = mod.GET;
  });

  afterEach(() => vi.restoreAllMocks());

  it("still returns 200 with status issues", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("issues");
    expect(json.database.ok).toBe(false);
    expect(json.database.error).toContain("SQLITE_CANTOPEN");
  });

  it("system info is still present even when db fails", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.system).toBeDefined();
    expect(json.system.nodeVersion).toMatch(/^v\d+/);
  });
});

// ─── Integration: localDb partial failure ────────────────────────────────────

describe("GET /api/monitoring/health — localDb partial failure", () => {
  let GET;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/lib/sqlite/connection.js", () => ({
      getDatabase: () => ({
        prepare: (sql) => ({
          get: () => {
            if (sql.includes("integrity_check")) return { integrity_check: "ok" };
            if (sql.includes("schema_version")) return { value: "1" };
            if (sql.includes("page_count")) return { page_count: 10 };
            if (sql.includes("page_size")) return { page_size: 4096 };
            if (sql.includes("journal_mode")) return { journal_mode: "wal" };
            return null;
          },
        }),
      }),
    }));

    vi.doMock("@/lib/localDb.js", () => ({
      getProviderConnections: async () => {
        throw new Error("db locked");
      },
      getCombos: async () => [],
      getApiKeys: async () => [],
      getSettings: async () => ({ requireApiKey: false, requireLogin: false }),
      getProviderNodes: async () => [],
    }));

    const mod = await import("@/app/api/monitoring/health/route.js");
    GET = mod.GET;
  });

  afterEach(() => vi.restoreAllMocks());

  it("still returns 200 with partial provider data", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers.total).toBe(0);
    expect(json.providers.enabled).toBe(0);
  });

  it("status is still healthy when only localDb fails", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.status).toBe("healthy");
  });
});
