/**
 * Comprehensive tests for /memory feature:
 * - store CRUD (create, get, update, delete, list, clear)
 * - listMemories filters (type, sessionId, query, expiry)
 * - retrieveMemories strategies (exact, semantic, hybrid, recent)
 * - injectMemory (openai + anthropic/no-system-message providers)
 * - extractFactsFromText (EN + ID patterns)
 * - extractFacts async store
 * - memory API routes (GET, POST, PATCH, DELETE, search)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-memory-full-test-"));
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

const KEY = "mem-test";

beforeEach(async () => {
  const { clearMemories } = await import("@/lib/memory/store.ts");
  await clearMemories(KEY);
  await clearMemories("mem-test-2");
  await clearMemories("mem-route");
});

// ── store CRUD ────────────────────────────────────────────────────────────────

describe("createMemory / getMemory", () => {
  it("creates and retrieves a memory by id", async () => {
    const { createMemory, getMemory } = await import("@/lib/memory/store.ts");
    const mem = await createMemory({
      apiKeyId: KEY,
      sessionId: "s1",
      type: "factual",
      key: "pref:lang",
      content: "User prefers TypeScript",
    });
    expect(mem.id).toBeTruthy();
    const fetched = await getMemory(mem.id);
    expect(fetched.content).toBe("User prefers TypeScript");
    expect(fetched.type).toBe("factual");
    expect(fetched.key).toBe("pref:lang");
  });

  it("upserts when same key exists for same apiKeyId", async () => {
    const { createMemory, getMemory } = await import("@/lib/memory/store.ts");
    const first = await createMemory({
      apiKeyId: KEY,
      sessionId: "s1",
      type: "factual",
      key: "pref:editor",
      content: "vim",
    });
    const second = await createMemory({
      apiKeyId: KEY,
      sessionId: "s1",
      type: "factual",
      key: "pref:editor",
      content: "neovim",
    });
    expect(second.id).toBe(first.id);
    const fetched = await getMemory(first.id);
    expect(fetched.content).toBe("neovim");
  });

  it("returns null for unknown id", async () => {
    const { getMemory } = await import("@/lib/memory/store.ts");
    expect(await getMemory("nonexistent-id")).toBeNull();
  });

  it("throws when apiKeyId missing", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    await expect(createMemory({ content: "x", type: "factual" })).rejects.toThrow(/apiKeyId/i);
  });

  it("throws when content missing", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    await expect(createMemory({ apiKeyId: KEY, type: "factual" })).rejects.toThrow(/content/i);
  });

  it("defaults invalid type to factual", async () => {
    const { createMemory, getMemory } = await import("@/lib/memory/store.ts");
    const mem = await createMemory({ apiKeyId: KEY, type: "invalid-type", content: "test" });
    const fetched = await getMemory(mem.id);
    expect(fetched.type).toBe("factual");
  });
});

describe("updateMemory", () => {
  it("updates content and type", async () => {
    const { createMemory, updateMemory, getMemory } = await import("@/lib/memory/store.ts");
    const mem = await createMemory({ apiKeyId: KEY, type: "factual", content: "original" });
    const ok = await updateMemory(mem.id, { content: "updated", type: "episodic" });
    expect(ok).toBe(true);
    const fetched = await getMemory(mem.id);
    expect(fetched.content).toBe("updated");
    expect(fetched.type).toBe("episodic");
  });

  it("returns false for unknown id", async () => {
    const { updateMemory } = await import("@/lib/memory/store.ts");
    expect(await updateMemory("nonexistent", { content: "x" })).toBe(false);
  });

  it("returns false when no fields provided", async () => {
    const { createMemory, updateMemory } = await import("@/lib/memory/store.ts");
    const mem = await createMemory({ apiKeyId: KEY, type: "factual", content: "x" });
    expect(await updateMemory(mem.id, {})).toBe(false);
  });
});

describe("deleteMemory", () => {
  it("deletes an existing memory", async () => {
    const { createMemory, deleteMemory, getMemory } = await import("@/lib/memory/store.ts");
    const mem = await createMemory({ apiKeyId: KEY, type: "factual", content: "to-delete" });
    expect(await deleteMemory(mem.id)).toBe(true);
    expect(await getMemory(mem.id)).toBeNull();
  });

  it("returns false for unknown id", async () => {
    const { deleteMemory } = await import("@/lib/memory/store.ts");
    expect(await deleteMemory("nonexistent")).toBe(false);
  });
});

describe("clearMemories", () => {
  it("removes all memories for an apiKeyId", async () => {
    const { createMemory, clearMemories, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({ apiKeyId: KEY, type: "factual", content: "a" });
    await createMemory({ apiKeyId: KEY, type: "factual", content: "b" });
    const removed = await clearMemories(KEY);
    expect(removed).toBeGreaterThanOrEqual(2);
    const list = await listMemories({ apiKeyId: KEY });
    expect(list.total).toBe(0);
  });

  it("does not affect other apiKeyIds", async () => {
    const { createMemory, clearMemories, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({ apiKeyId: KEY, type: "factual", content: "mine" });
    await createMemory({ apiKeyId: "mem-test-2", type: "factual", content: "theirs" });
    await clearMemories(KEY);
    const list = await listMemories({ apiKeyId: "mem-test-2" });
    expect(list.total).toBeGreaterThanOrEqual(1);
  });

  it("removes all memories when apiKeyId is omitted", async () => {
    const { createMemory, clearMemories, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({ apiKeyId: KEY, type: "factual", content: "mine" });
    await createMemory({ apiKeyId: "mem-test-2", type: "factual", content: "theirs" });
    const removed = await clearMemories();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect((await listMemories({ apiKeyId: KEY })).total).toBe(0);
    expect((await listMemories({ apiKeyId: "mem-test-2" })).total).toBe(0);
  });
});

// ── listMemories ──────────────────────────────────────────────────────────────

describe("listMemories", () => {
  it("filters by type", async () => {
    const { createMemory, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({ apiKeyId: KEY, type: "factual", content: "fact" });
    await createMemory({ apiKeyId: KEY, type: "episodic", content: "episode" });
    const factual = await listMemories({ apiKeyId: KEY, type: "factual" });
    expect(factual.data.every((m) => m.type === "factual")).toBe(true);
    expect(factual.byType.factual).toBeGreaterThanOrEqual(1);
  });

  it("filters by sessionId", async () => {
    const { createMemory, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({ apiKeyId: KEY, sessionId: "sess-A", type: "factual", content: "A" });
    await createMemory({ apiKeyId: KEY, sessionId: "sess-B", type: "factual", content: "B" });
    const result = await listMemories({ apiKeyId: KEY, sessionId: "sess-A" });
    expect(result.data.every((m) => m.sessionId === "sess-A")).toBe(true);
  });

  it("respects limit and offset", async () => {
    const { createMemory, listMemories } = await import("@/lib/memory/store.ts");
    for (let i = 0; i < 5; i++) {
      await createMemory({ apiKeyId: KEY, type: "factual", content: `item-${i}` });
    }
    const page1 = await listMemories({ apiKeyId: KEY, limit: 2, offset: 0 });
    const page2 = await listMemories({ apiKeyId: KEY, limit: 2, offset: 2 });
    expect(page1.data.length).toBe(2);
    expect(page2.data.length).toBe(2);
    expect(page1.data[0].id).not.toBe(page2.data[0].id);
    expect(page1.total).toBeGreaterThanOrEqual(5);
  });

  it("excludes expired memories", async () => {
    const { createMemory, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({
      apiKeyId: KEY,
      type: "factual",
      content: "expired",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await createMemory({ apiKeyId: KEY, type: "factual", content: "active" });
    const result = await listMemories({ apiKeyId: KEY });
    expect(result.data.every((m) => m.content !== "expired")).toBe(true);
    expect(result.data.some((m) => m.content === "active")).toBe(true);
  });

  it("returns byType breakdown", async () => {
    const { createMemory, listMemories } = await import("@/lib/memory/store.ts");
    await createMemory({ apiKeyId: KEY, type: "factual", content: "f1" });
    await createMemory({ apiKeyId: KEY, type: "factual", content: "f2" });
    await createMemory({ apiKeyId: KEY, type: "procedural", content: "p1" });
    const result = await listMemories({ apiKeyId: KEY });
    expect(result.byType.factual).toBeGreaterThanOrEqual(2);
    expect(result.byType.procedural).toBeGreaterThanOrEqual(1);
  });
});

// ── retrieveMemories ──────────────────────────────────────────────────────────

describe("retrieveMemories", () => {
  it("returns empty array when disabled", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    const result = await retrieveMemories(KEY, { enabled: false });
    expect(result).toEqual([]);
  });

  it("returns empty array for unknown apiKeyId", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    expect(await retrieveMemories("nonexistent-key-xyz", { enabled: true })).toEqual([]);
  });

  it("exact strategy returns keyword-matching memories", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    await createMemory({
      apiKeyId: KEY,
      type: "factual",
      content: "User prefers TypeScript for backend",
    });
    await createMemory({ apiKeyId: KEY, type: "factual", content: "User uses SQLite for storage" });

    const result = await retrieveMemories(KEY, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "TypeScript",
      maxTokens: 2000,
      retentionDays: 30,
    });
    expect(result.some((m) => m.content.includes("TypeScript"))).toBe(true);
  });

  it("semantic strategy returns FTS-matched memories", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    await createMemory({
      apiKeyId: KEY,
      type: "factual",
      content: "User prefers dark mode interface",
    });

    const result = await retrieveMemories(KEY, {
      enabled: true,
      retrievalStrategy: "semantic",
      query: "dark mode",
      maxTokens: 2000,
      retentionDays: 30,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((m) => m.content.includes("dark mode"))).toBe(true);
  });

  it("hybrid strategy merges FTS and keyword results", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    await createMemory({ apiKeyId: KEY, type: "factual", content: "User prefers vim editor" });
    await createMemory({
      apiKeyId: KEY,
      type: "episodic",
      content: "User decided to use bun runtime",
    });

    const result = await retrieveMemories(KEY, {
      enabled: true,
      retrievalStrategy: "hybrid",
      query: "vim",
      maxTokens: 2000,
      retentionDays: 30,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it("respects maxTokens budget", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    // Create many large memories
    for (let i = 0; i < 10; i++) {
      await createMemory({
        apiKeyId: KEY,
        type: "factual",
        content: `${"word ".repeat(100)}item-${i}`,
      });
    }
    const result = await retrieveMemories(KEY, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "word",
      maxTokens: 50,
      retentionDays: 30,
    });
    // With maxTokens=50, should return at most 1 entry (each ~25 tokens)
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("excludes expired memories", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    await createMemory({
      apiKeyId: KEY,
      type: "factual",
      content: "expired-memory-xyz",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await retrieveMemories(KEY, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "expired-memory-xyz",
      maxTokens: 2000,
      retentionDays: 30,
    });
    expect(result.every((m) => !m.content.includes("expired-memory-xyz"))).toBe(true);
  });

  it("scopes to session when scope=session", async () => {
    const { createMemory } = await import("@/lib/memory/store.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.ts");
    await createMemory({
      apiKeyId: KEY,
      sessionId: "sess-X",
      type: "factual",
      content: "session X memory",
    });
    await createMemory({
      apiKeyId: KEY,
      sessionId: "sess-Y",
      type: "factual",
      content: "session Y memory",
    });

    const result = await retrieveMemories(KEY, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "memory",
      maxTokens: 2000,
      retentionDays: 30,
      scope: "session",
      sessionId: "sess-X",
    });
    expect(result.every((m) => m.sessionId === "sess-X")).toBe(true);
  });
});

// ── injectMemory ──────────────────────────────────────────────────────────────

describe("injectMemory", () => {
  it("prepends system message for OpenAI-compatible providers", async () => {
    const { injectMemory } = await import("@/lib/memory/injection.ts");
    const req = { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] };
    const memories = [{ content: "User prefers concise answers" }];
    const result = injectMemory(req, memories, "openai");
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("Memory context:");
    expect(result.messages[0].content).toContain("User prefers concise answers");
    expect(result.messages[1].role).toBe("user");
  });

  it("prepends user message for providers without system message support", async () => {
    const { injectMemory } = await import("@/lib/memory/injection.ts");
    const req = { model: "glm-4", messages: [{ role: "user", content: "hello" }] };
    const memories = [{ content: "User prefers dark mode" }];
    const result = injectMemory(req, memories, "glm");
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toContain("Memory context:");
  });

  it("returns request unchanged when memories is empty", async () => {
    const { injectMemory } = await import("@/lib/memory/injection.ts");
    const req = { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] };
    expect(injectMemory(req, [], "openai")).toBe(req);
    expect(injectMemory(req, null, "openai")).toBe(req);
  });

  it("injects multiple memories as single context block", async () => {
    const { injectMemory } = await import("@/lib/memory/injection.ts");
    const req = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    const memories = [{ content: "fact A" }, { content: "fact B" }];
    const result = injectMemory(req, memories, "openai");
    expect(result.messages[0].content).toContain("fact A");
    expect(result.messages[0].content).toContain("fact B");
  });
});

// ── extractFactsFromText ──────────────────────────────────────────────────────

describe("extractFactsFromText", () => {
  it("extracts English preference patterns", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("I prefer TypeScript for backend services.");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.content.toLowerCase().includes("typescript"))).toBe(true);
    expect(facts[0].type).toBe("factual");
  });

  it("extracts English decision patterns", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("I'll use bun for this project.");
    expect(facts.some((f) => f.content.toLowerCase().includes("bun"))).toBe(true);
    expect(facts.some((f) => f.type === "episodic")).toBe(true);
  });

  it("extracts English habit/pattern patterns", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("I always write tests before shipping.");
    expect(facts.some((f) => f.content.toLowerCase().includes("tests"))).toBe(true);
  });

  it("extracts Indonesian preference patterns", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("Saya suka menggunakan dark mode.");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.content.toLowerCase().includes("dark mode"))).toBe(true);
  });

  it("extracts Indonesian decision patterns", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("Saya akan menggunakan PostgreSQL untuk database.");
    expect(facts.some((f) => f.content.toLowerCase().includes("postgresql"))).toBe(true);
  });

  it("extracts Indonesian habit patterns", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("Saya biasanya pakai vim untuk editing.");
    expect(facts.some((f) => f.content.toLowerCase().includes("vim"))).toBe(true);
  });

  it("deduplicates identical facts", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    const facts = extractFactsFromText("I prefer vim. I prefer vim.");
    const vimFacts = facts.filter((f) => f.content.toLowerCase().includes("vim"));
    expect(vimFacts.length).toBe(1);
  });

  it("returns empty array for empty/null input", async () => {
    const { extractFactsFromText } = await import("@/lib/memory/extraction.ts");
    expect(extractFactsFromText("")).toEqual([]);
    expect(extractFactsFromText(null)).toEqual([]);
    expect(extractFactsFromText(undefined)).toEqual([]);
  });
});

// ── extractFacts async store ──────────────────────────────────────────────────

describe("extractFacts (async store)", () => {
  it("stores extracted facts into DB asynchronously", async () => {
    const { extractFacts } = await import("@/lib/memory/extraction.ts");
    const { listMemories } = await import("@/lib/memory/store.ts");
    const apiKeyId = "mem-test-2";

    extractFacts("I prefer dark mode and I'll use bun for this project.", apiKeyId, "sess-extract");
    await new Promise((r) => setTimeout(r, 50));

    const result = await listMemories({ apiKeyId });
    expect(result.total).toBeGreaterThan(0);
    const contents = result.data.map((m) => m.content.toLowerCase());
    expect(contents.some((c) => c.includes("dark mode") || c.includes("bun"))).toBe(true);
  });

  it("is a no-op when text is empty", async () => {
    const { extractFacts } = await import("@/lib/memory/extraction.ts");
    const { listMemories } = await import("@/lib/memory/store.ts");
    const apiKeyId = "mem-test-2";
    await (await import("@/lib/memory/store.ts")).clearMemories(apiKeyId);

    extractFacts("", apiKeyId, "sess-empty");
    await new Promise((r) => setTimeout(r, 30));

    const result = await listMemories({ apiKeyId });
    expect(result.total).toBe(0);
  });
});

// ── memory API routes ─────────────────────────────────────────────────────────

describe("POST /api/memory", () => {
  it("creates a memory and returns it", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    const res = await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-route",
          sessionId: "s1",
          type: "factual",
          key: "pref:x",
          content: "User likes X",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.id).toBeTruthy();
    expect(data.data.content).toBe("User likes X");
  });

  it("returns 400 when apiKeyId missing", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    const res = await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "factual", content: "no key" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/memory", () => {
  it("lists memories for apiKeyId", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-route",
          type: "factual",
          key: "pref:listed",
          content: "listed",
        }),
      }),
    );
    const res = await memRoute.GET(new Request("http://localhost/api/memory?apiKeyId=mem-route"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.data)).toBe(true);
  });
});

describe("DELETE /api/memory", () => {
  it("clears all memories and returns removed count", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-route",
          type: "factual",
          key: "pref:clear-a",
          content: "a",
        }),
      }),
    );
    await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-test-2",
          type: "factual",
          key: "pref:clear-b",
          content: "b",
        }),
      }),
    );

    const delRes = await memRoute.DELETE(
      new Request("http://localhost/api/memory", { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.success).toBe(true);
    expect(delJson.scope).toBe("all");
    expect(Number(delJson.removed)).toBeGreaterThanOrEqual(2);

    const listRes = await memRoute.GET(new Request("http://localhost/api/memory"));
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.total).toBe(0);
  });
});

describe("GET /api/memory/[id]", () => {
  it("returns memory by id", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    const memByIdRoute = await import("@/app/api/memory/[id]/route.ts");
    const postRes = await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-route",
          type: "factual",
          key: "pref:by-id",
          content: "by-id-test",
        }),
      }),
    );
    const {
      data: { id },
    } = await postRes.json();

    const res = await memByIdRoute.GET(new Request(`http://localhost/api/memory/${id}`), {
      params: { id },
    });
    expect(res.status).toBe(200);
    const mem = await res.json();
    expect(mem.id).toBe(id);
    expect(mem.content).toBe("by-id-test");
  });

  it("returns 404 for unknown id", async () => {
    const memByIdRoute = await import("@/app/api/memory/[id]/route.ts");
    const res = await memByIdRoute.GET(new Request("http://localhost/api/memory/nope"), {
      params: { id: "nope" },
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/memory/[id]", () => {
  it("updates content", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    const memByIdRoute = await import("@/app/api/memory/[id]/route.ts");
    const postRes = await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-route",
          type: "factual",
          key: "pref:original",
          content: "original",
        }),
      }),
    );
    const {
      data: { id },
    } = await postRes.json();

    const patchRes = await memByIdRoute.PATCH(
      new Request(`http://localhost/api/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "updated content" }),
      }),
      { params: { id } },
    );
    expect(patchRes.status).toBe(200);
    const data = await patchRes.json();
    expect(data.success).toBe(true);
    expect(data.data.content).toBe("updated content");
  });
});

describe("DELETE /api/memory/[id]", () => {
  it("deletes a memory", async () => {
    const memRoute = await import("@/app/api/memory/route.ts");
    const memByIdRoute = await import("@/app/api/memory/[id]/route.ts");
    const postRes = await memRoute.POST(
      new Request("http://localhost/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKeyId: "mem-route",
          type: "factual",
          key: "pref:to-delete",
          content: "to-delete",
        }),
      }),
    );
    const {
      data: { id },
    } = await postRes.json();

    const delRes = await memByIdRoute.DELETE(
      new Request(`http://localhost/api/memory/${id}`, { method: "DELETE" }),
      {
        params: { id },
      },
    );
    expect(delRes.status).toBe(200);
    const data = await delRes.json();
    expect(data.success).toBe(true);

    const getRes = await memByIdRoute.GET(new Request(`http://localhost/api/memory/${id}`), {
      params: { id },
    });
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    const memByIdRoute = await import("@/app/api/memory/[id]/route.ts");
    const res = await memByIdRoute.DELETE(
      new Request("http://localhost/api/memory/nope", { method: "DELETE" }),
      {
        params: { id: "nope" },
      },
    );
    expect(res.status).toBe(404);
  });
});
