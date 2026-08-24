/**
 * Comprehensive memory strategy tests.
 * Covers: settings normalization, extraction, injection, retrieval strategies, store operations.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFactsFromText } from "../../src/lib/memory/extraction.ts";
import {
  formatMemoryContext,
  injectMemory,
  providerSupportsSystemMessage,
  shouldInjectMemory,
} from "../../src/lib/memory/injection.ts";
import { normalizeMemorySettings, toMemoryRetrievalConfig } from "../../src/lib/memory/settings.ts";
import { MemoryType } from "../../src/lib/memory/types.ts";

// ─── Group 1: Settings normalization ─────────────────────────────────────────

describe("normalizeMemorySettings", () => {
  it("returns defaults when called with empty object", () => {
    const s = normalizeMemorySettings({});
    expect(s.enabled).toBe(true);
    expect(s.maxTokens).toBe(2000);
    expect(s.retentionDays).toBe(30);
    expect(s.strategy).toBe("hybrid");
  });

  it("respects custom values", () => {
    const s = normalizeMemorySettings({
      memoryEnabled: false,
      memoryMaxTokens: 500,
      memoryRetentionDays: 7,
      memoryStrategy: "semantic",
    });
    expect(s.enabled).toBe(false);
    expect(s.maxTokens).toBe(500);
    expect(s.retentionDays).toBe(7);
    expect(s.strategy).toBe("semantic");
  });

  it("clamps maxTokens to [0, 16000]", () => {
    expect(normalizeMemorySettings({ memoryMaxTokens: -1 }).maxTokens).toBe(0);
    expect(normalizeMemorySettings({ memoryMaxTokens: 99999 }).maxTokens).toBe(16000);
  });

  it("clamps retentionDays to [1, 365]", () => {
    expect(normalizeMemorySettings({ memoryRetentionDays: 0 }).retentionDays).toBe(1);
    expect(normalizeMemorySettings({ memoryRetentionDays: 999 }).retentionDays).toBe(365);
  });

  it("falls back to hybrid for unknown strategy", () => {
    expect(normalizeMemorySettings({ memoryStrategy: "unknown" }).strategy).toBe("hybrid");
  });
});

describe("toMemoryRetrievalConfig", () => {
  it("maps 'recent' strategy → 'exact'", () => {
    const cfg = toMemoryRetrievalConfig({
      enabled: true,
      maxTokens: 2000,
      strategy: "recent",
      retentionDays: 30,
    });
    expect(cfg.retrievalStrategy).toBe("exact");
  });

  it("maps 'semantic' strategy → 'semantic'", () => {
    const cfg = toMemoryRetrievalConfig({
      enabled: true,
      maxTokens: 2000,
      strategy: "semantic",
      retentionDays: 30,
    });
    expect(cfg.retrievalStrategy).toBe("semantic");
  });

  it("maps 'hybrid' strategy → 'hybrid'", () => {
    const cfg = toMemoryRetrievalConfig({
      enabled: true,
      maxTokens: 2000,
      strategy: "hybrid",
      retentionDays: 30,
    });
    expect(cfg.retrievalStrategy).toBe("hybrid");
  });

  it("disabled when maxTokens=0", () => {
    const cfg = toMemoryRetrievalConfig({
      enabled: true,
      maxTokens: 0,
      strategy: "hybrid",
      retentionDays: 30,
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxTokens).toBe(0);
  });

  it("disabled when enabled=false", () => {
    const cfg = toMemoryRetrievalConfig({
      enabled: false,
      maxTokens: 2000,
      strategy: "hybrid",
      retentionDays: 30,
    });
    expect(cfg.enabled).toBe(false);
  });
});

// ─── Group 2: Extraction ──────────────────────────────────────────────────────

describe("extractFactsFromText — preferences", () => {
  it("extracts 'I prefer X'", () => {
    const facts = extractFactsFromText("I prefer TypeScript over JavaScript");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].content).toContain("TypeScript");
    expect(facts[0].type).toBe(MemoryType.FACTUAL);
    expect(facts[0].category).toBe("preference");
  });

  it("extracts 'I like X'", () => {
    const facts = extractFactsFromText("I like dark mode interfaces");
    expect(facts.some((f) => f.content.toLowerCase().includes("dark mode"))).toBe(true);
  });

  it("extracts 'my favorite is X'", () => {
    const facts = extractFactsFromText("my favorite is vim");
    expect(facts.some((f) => f.content.toLowerCase().includes("vim"))).toBe(true);
  });

  it("extracts 'I hate X'", () => {
    const facts = extractFactsFromText("I hate JavaScript");
    expect(facts.some((f) => f.content.toLowerCase().includes("javascript"))).toBe(true);
  });
});

describe("extractFactsFromText — decisions", () => {
  it("extracts 'I decided to X'", () => {
    const facts = extractFactsFromText("I decided to use React for this project");
    expect(facts.some((f) => f.type === MemoryType.EPISODIC)).toBe(true);
    expect(facts.some((f) => f.category === "decision")).toBe(true);
  });

  it("extracts 'I'll use X'", () => {
    const facts = extractFactsFromText("I'll use PostgreSQL for the database");
    expect(facts.some((f) => f.content.toLowerCase().includes("postgresql"))).toBe(true);
    expect(facts.some((f) => f.type === MemoryType.EPISODIC)).toBe(true);
  });

  it("extracts 'I went with X'", () => {
    const facts = extractFactsFromText("I went with bun instead of npm");
    expect(facts.some((f) => f.category === "decision")).toBe(true);
  });
});

describe("extractFactsFromText — patterns", () => {
  it("extracts 'I usually X'", () => {
    const facts = extractFactsFromText("I usually write tests first");
    expect(facts.some((f) => f.content.toLowerCase().includes("write tests"))).toBe(true);
    expect(facts.some((f) => f.type === MemoryType.FACTUAL)).toBe(true);
  });

  it("extracts 'I always X'", () => {
    const facts = extractFactsFromText("I always use TypeScript");
    expect(facts.some((f) => f.content.toLowerCase().includes("typescript"))).toBe(true);
  });

  it("extracts 'I never X'", () => {
    const facts = extractFactsFromText("I never use var in JavaScript");
    expect(facts.some((f) => f.category === "pattern")).toBe(true);
  });
});

describe("extractFactsFromText — Indonesian", () => {
  it("extracts 'saya suka X'", () => {
    const facts = extractFactsFromText("saya suka TypeScript");
    expect(facts.some((f) => f.content.toLowerCase().includes("typescript"))).toBe(true);
  });

  it("extracts 'saya memilih X'", () => {
    const facts = extractFactsFromText("saya memilih React untuk project ini");
    expect(facts.some((f) => f.category === "decision")).toBe(true);
  });

  it("extracts 'saya biasanya X'", () => {
    const facts = extractFactsFromText("saya biasanya pakai dark mode");
    expect(facts.some((f) => f.category === "pattern")).toBe(true);
  });
});

describe("extractFactsFromText — edge cases", () => {
  it("returns empty array for text with no patterns", () => {
    const facts = extractFactsFromText("The weather is nice today");
    expect(facts).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractFactsFromText("")).toEqual([]);
  });

  it("returns empty array for null/undefined", () => {
    expect(extractFactsFromText(null)).toEqual([]);
    expect(extractFactsFromText(undefined)).toEqual([]);
  });

  it("deduplicates same key", () => {
    const facts = extractFactsFromText("I prefer TypeScript. I prefer TypeScript.");
    const keys = facts.map((f) => f.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it("key is slugified correctly", () => {
    const facts = extractFactsFromText("I prefer TypeScript over JavaScript");
    expect(facts[0].key).toMatch(/^preference:[a-z0-9_]+$/);
  });
});

// ─── Group 3: Injection ───────────────────────────────────────────────────────

describe("injectMemory", () => {
  const memories = [{ content: "User prefers TypeScript" }, { content: "User likes dark mode" }];

  it("prepends system message for normal providers", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const result = injectMemory(body, memories, "openai");
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("Memory context:");
    expect(result.messages[0].content).toContain("User prefers TypeScript");
    expect(result.messages[1].role).toBe("user");
  });

  it("prepends user message for 'o1' provider", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const result = injectMemory(body, memories, "o1");
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toContain("Memory context:");
  });

  it("prepends user message for 'glm' provider", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const result = injectMemory(body, memories, "glm");
    expect(result.messages[0].role).toBe("user");
  });

  it("returns body unchanged for empty memories array", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const result = injectMemory(body, [], "openai");
    expect(result).toEqual(body);
  });

  it("returns body unchanged for null memories", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const result = injectMemory(body, null, "openai");
    expect(result).toEqual(body);
  });

  it("does not mutate original body", () => {
    const body = { messages: [{ role: "user", content: "Hello" }] };
    const original = JSON.stringify(body);
    injectMemory(body, memories, "openai");
    expect(JSON.stringify(body)).toBe(original);
  });
});

describe("formatMemoryContext", () => {
  it("formats multiple memories with newline separator", () => {
    const memories = [{ content: "fact one" }, { content: "fact two" }];
    const result = formatMemoryContext(memories);
    expect(result).toBe("Memory context: fact one\nfact two");
  });

  it("returns empty string for empty array", () => {
    expect(formatMemoryContext([])).toBe("");
  });

  it("filters out empty content", () => {
    const memories = [{ content: "fact one" }, { content: "" }, { content: "fact two" }];
    const result = formatMemoryContext(memories);
    expect(result).toBe("Memory context: fact one\nfact two");
  });
});

describe("shouldInjectMemory", () => {
  it("returns false when disabled", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    expect(shouldInjectMemory(body, { enabled: false })).toBe(false);
  });

  it("returns true when enabled with messages", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    expect(shouldInjectMemory(body, { enabled: true })).toBe(true);
  });

  it("returns false for empty messages array", () => {
    const body = { messages: [] };
    expect(shouldInjectMemory(body, { enabled: true })).toBe(false);
  });

  it("returns false for null body", () => {
    expect(shouldInjectMemory(null, { enabled: true })).toBe(false);
  });
});

describe("providerSupportsSystemMessage", () => {
  it("returns true for openai", () => expect(providerSupportsSystemMessage("openai")).toBe(true));
  it("returns true for anthropic", () =>
    expect(providerSupportsSystemMessage("anthropic")).toBe(true));
  it("returns false for o1", () => expect(providerSupportsSystemMessage("o1")).toBe(false));
  it("returns false for glm", () => expect(providerSupportsSystemMessage("glm")).toBe(false));
  it("returns false for zai", () => expect(providerSupportsSystemMessage("zai")).toBe(false));
  it("returns true for null/undefined", () => {
    expect(providerSupportsSystemMessage(null)).toBe(true);
    expect(providerSupportsSystemMessage(undefined)).toBe(true);
  });
});

// ─── Group 4: Retrieval strategies (mock DB) ─────────────────────────────────

vi.mock("../../src/lib/sqlite/connection.ts", () => ({
  getDatabase: vi.fn(),
}));

describe("retrieveMemories — strategy behavior", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns [] for empty apiKeyId", async () => {
    const { retrieveMemories } = await import("../../src/lib/memory/retrieval.ts");
    const result = await retrieveMemories("", { enabled: true, maxTokens: 2000 });
    expect(result).toEqual([]);
  });

  it("returns [] when disabled", async () => {
    const { retrieveMemories } = await import("../../src/lib/memory/retrieval.ts");
    const result = await retrieveMemories("user-1", { enabled: false, maxTokens: 2000 });
    expect(result).toEqual([]);
  });

  it("returns [] when maxTokens=0 (effectively disabled)", async () => {
    const { getDatabase } = await import("../../src/lib/sqlite/connection.ts");
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({ name: null }),
      }),
    };
    getDatabase.mockReturnValue(mockDb);
    const { retrieveMemories } = await import("../../src/lib/memory/retrieval.ts");
    const result = await retrieveMemories("user-1", { enabled: true, maxTokens: 0 });
    expect(result).toEqual([]);
  });

  it("'recent' strategy works as alias for 'exact'", async () => {
    const { getDatabase } = await import("../../src/lib/sqlite/connection.ts");
    const now = new Date().toISOString();
    const mockRows = [
      {
        id: "1",
        api_key_id: "user-1",
        session_id: "",
        type: "factual",
        key: "pref:ts",
        content: "I prefer TypeScript",
        metadata: null,
        created_at: now,
        updated_at: now,
        expires_at: null,
      },
    ];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockRows),
        get: vi.fn().mockReturnValue({ name: null }),
      }),
    };
    getDatabase.mockReturnValue(mockDb);
    const { retrieveMemories } = await import("../../src/lib/memory/retrieval.ts");
    const result = await retrieveMemories("user-1", {
      enabled: true,
      maxTokens: 2000,
      retrievalStrategy: "recent",
      retentionDays: 30,
    });
    expect(result.length).toBe(1);
    expect(result[0].content).toBe("I prefer TypeScript");
  });

  it("respects maxTokens budget", async () => {
    const { getDatabase } = await import("../../src/lib/sqlite/connection.ts");
    const now = new Date().toISOString();
    // Each entry ~25 tokens (100 chars / 4)
    const mockRows = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      api_key_id: "user-1",
      session_id: "",
      type: "factual",
      key: `pref:item${i}`,
      content: "x".repeat(100),
      metadata: null,
      created_at: now,
      updated_at: now,
      expires_at: null,
    }));
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockRows),
        get: vi.fn().mockReturnValue({ name: null }),
      }),
    };
    getDatabase.mockReturnValue(mockDb);
    const { retrieveMemories } = await import("../../src/lib/memory/retrieval.ts");
    // maxTokens=50 → only 2 entries (2 * 25 = 50)
    const result = await retrieveMemories("user-1", {
      enabled: true,
      maxTokens: 50,
      retrievalStrategy: "exact",
      retentionDays: 30,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("always returns at least one memory even if over budget", async () => {
    const { getDatabase } = await import("../../src/lib/sqlite/connection.ts");
    const now = new Date().toISOString();
    const mockRows = [
      {
        id: "1",
        api_key_id: "user-1",
        session_id: "",
        type: "factual",
        key: "pref:big",
        content: "x".repeat(10000), // ~2500 tokens
        metadata: null,
        created_at: now,
        updated_at: now,
        expires_at: null,
      },
    ];
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockReturnValue(mockRows),
        get: vi.fn().mockReturnValue({ name: null }),
      }),
    };
    getDatabase.mockReturnValue(mockDb);
    const { retrieveMemories } = await import("../../src/lib/memory/retrieval.ts");
    // maxTokens=100 but single entry is 2500 tokens — should still return it
    const result = await retrieveMemories("user-1", {
      enabled: true,
      maxTokens: 100,
      retrievalStrategy: "exact",
      retentionDays: 30,
    });
    expect(result.length).toBe(1);
  });
});
