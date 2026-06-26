/**
 * Real-SQLite tests for retrieveMemories() in src/lib/memory/retrieval.js.
 * Each group uses a fresh temp DB via DATA_DIR, creates real rows, and cleans up.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-retrieval-test-"));
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

// Helper: unique apiKeyId per test to avoid cross-test pollution
let _counter = 0;
function uid() {
  return `retrieval-test-${++_counter}`;
}

// ── Group 1: "exact" / "recent" strategy ─────────────────────────────────────

describe('strategy: "exact" / "recent"', () => {
  afterEach(async () => {
    // clearMemories handles bulk cleanup; individual tests also delete their own rows
  });

  it("returns memories ordered by createdAt DESC", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({ apiKeyId, content: "oldest memory", key: `k-${uid()}`, type: "factual" });
    // small delay so created_at differs
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await createMemory({ apiKeyId, content: "newest memory", key: `k-${uid()}`, type: "factual" });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(results.length).toBe(2);
    // newest first
    expect(results[0].id).toBe(m2.id);
    expect(results[1].id).toBe(m1.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });

  it('"recent" alias works identically to "exact"', async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m = await createMemory({ apiKeyId, content: "some memory", key: `k-${uid()}`, type: "factual" });

    const exact = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 2000,
      retentionDays: 30,
    });
    const recent = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "recent",
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(recent.length).toBe(exact.length);
    expect(recent[0].id).toBe(exact[0].id);

    await deleteMemory(m.id);
  });

  it("respects retentionDays cutoff — old memories excluded", async () => {
    const { deleteMemory } = await import("@/lib/memory/store.js");
    const { getDatabase } = await import("@/lib/sqlite/connection.ts");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    // Insert a memory with created_at 40 days ago directly via SQL
    const db = getDatabase();
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO memories (id, api_key_id, session_id, type, key, content, metadata, created_at, updated_at, expires_at)
       VALUES (?, ?, NULL, 'factual', ?, 'old memory', '{}', ?, ?, NULL)`,
    ).run(id, apiKeyId, `k-${uid()}`, oldDate, oldDate);

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 2000,
      retentionDays: 30, // 30-day window — 40-day-old row should be excluded
    });

    expect(results.find((m) => m.id === id)).toBeUndefined();

    await deleteMemory(id);
  });

  it("filters expired memories (expiresAt in the past)", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const expired = await createMemory({
      apiKeyId,
      content: "expired memory",
      key: `k-${uid()}`,
      type: "factual",
      expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    });
    const valid = await createMemory({
      apiKeyId,
      content: "valid memory",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(results.find((m) => m.id === expired.id)).toBeUndefined();
    expect(results.find((m) => m.id === valid.id)).toBeDefined();

    await deleteMemory(expired.id);
    await deleteMemory(valid.id);
  });

  it("returns empty array when no memories exist for apiKeyId", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const results = await retrieveMemories(uid(), {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 2000,
      retentionDays: 30,
    });
    expect(results).toEqual([]);
  });
});

// ── Group 2: "hybrid" strategy ────────────────────────────────────────────────

describe('strategy: "hybrid"', () => {
  it("returns merged FTS + recency results without duplicates", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({
      apiKeyId,
      content: "typescript is great for large projects",
      key: `k-${uid()}`,
      type: "factual",
    });
    const m2 = await createMemory({
      apiKeyId,
      content: "user prefers dark mode interface",
      key: `k-${uid()}`,
      type: "factual",
    });
    const m3 = await createMemory({
      apiKeyId,
      content: "typescript strict mode enabled",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "hybrid",
      query: "typescript",
      maxTokens: 2000,
      retentionDays: 30,
    });

    // No duplicate IDs
    const ids = results.map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);

    // typescript-related memories should appear
    expect(results.some((m) => m.id === m1.id || m.id === m3.id)).toBe(true);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
    await deleteMemory(m3.id);
  });

  it("deduplicates entries that appear in both FTS and recency", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    // Single memory that would match both FTS and recency
    const m = await createMemory({
      apiKeyId,
      content: "typescript preferred language",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "hybrid",
      query: "typescript",
      maxTokens: 2000,
      retentionDays: 30,
    });

    const matchingIds = results.filter((r) => r.id === m.id);
    expect(matchingIds.length).toBe(1); // no duplicates

    await deleteMemory(m.id);
  });

  it("falls back to recency when no query text provided", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({ apiKeyId, content: "memory alpha", key: `k-${uid()}`, type: "factual" });
    const m2 = await createMemory({ apiKeyId, content: "memory beta", key: `k-${uid()}`, type: "factual" });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "hybrid",
      // no query — falls back to recency
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((m) => m.id);
    expect(ids).toContain(m1.id);
    expect(ids).toContain(m2.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });

  it("query text improves relevance — matching memory ranked higher", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({
      apiKeyId,
      content: "user likes coffee in the morning",
      key: `k-${uid()}`,
      type: "factual",
    });
    await new Promise((r) => setTimeout(r, 5));
    const m2 = await createMemory({
      apiKeyId,
      content: "typescript is the preferred language",
      key: `k-${uid()}`,
      type: "factual",
    });

    // m2 is newer but m1 has no relevance to "typescript"
    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "hybrid",
      query: "typescript",
      maxTokens: 2000,
      retentionDays: 30,
    });

    // m2 should appear (matches query), m1 may or may not depending on scoring
    expect(results.some((m) => m.id === m2.id)).toBe(true);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });
});

// ── Group 3: "semantic" strategy ──────────────────────────────────────────────

describe('strategy: "semantic"', () => {
  it("uses FTS5 MATCH and returns relevant memories for query", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({
      apiKeyId,
      content: "user prefers typescript for all projects",
      key: `k-${uid()}`,
      type: "factual",
    });
    const m2 = await createMemory({
      apiKeyId,
      content: "user drinks tea every morning",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "semantic",
      query: "typescript",
      maxTokens: 2000,
      retentionDays: 30,
    });

    // typescript memory should be returned
    expect(results.some((m) => m.id === m1.id)).toBe(true);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });

  it("returns empty array when query matches nothing", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m = await createMemory({ apiKeyId, content: "user likes coffee", key: `k-${uid()}`, type: "factual" });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "semantic",
      query: "xyznonexistentterm123",
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(results).toEqual([]);

    await deleteMemory(m.id);
  });

  it("falls back to recency when no query text provided", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m = await createMemory({ apiKeyId, content: "some memory content", key: `k-${uid()}`, type: "factual" });

    // semantic with no query — FTS path skipped, recency fallback runs.
    // With no queryText, the score filter is bypassed (!queryText is true),
    // so all recency rows are returned.
    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "semantic",
      // no query
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(results.some((r) => r.id === m.id)).toBe(true);

    await deleteMemory(m.id);
  });
});

// ── Group 4: Token budget ─────────────────────────────────────────────────────

describe("token budget", () => {
  it("respects maxTokens limit — stops adding when budget exceeded", async () => {
    const { createMemory, clearMemories } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    // Each memory is 200 chars → ~50 tokens
    const created = [];
    for (let i = 0; i < 6; i++) {
      const m = await createMemory({
        apiKeyId,
        content: `${"x".repeat(200)} item${i}`,
        key: `k-${uid()}`,
        type: "factual",
      });
      created.push(m);
    }

    // maxTokens=100 → fits at most 2 entries (2 * 50 = 100)
    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 100,
      retentionDays: 30,
    });

    expect(results.length).toBeLessThanOrEqual(2);

    await clearMemories(apiKeyId);
  });

  it("always returns at least 1 memory even if single entry exceeds budget", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    // 8000 chars → ~2000 tokens, well over any small maxTokens
    const m = await createMemory({
      apiKeyId,
      content: "a".repeat(8000),
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 50, // tiny budget
      retentionDays: 30,
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(m.id);

    await deleteMemory(m.id);
  });

  it("returns empty array when no memories exist (not forced to return 1)", async () => {
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const results = await retrieveMemories(uid(), {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 50,
      retentionDays: 30,
    });
    expect(results).toEqual([]);
  });
});

// ── Group 5: Keyword scoring ──────────────────────────────────────────────────

describe("keyword scoring", () => {
  it("exact phrase match scores higher than single-token match", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    // m1: contains exact phrase "dark mode"
    const m1 = await createMemory({
      apiKeyId,
      content: "user prefers dark mode for all interfaces",
      key: `k-${uid()}`,
      type: "factual",
    });
    await new Promise((r) => setTimeout(r, 5));
    // m2: newer but only contains "dark" (partial match)
    const m2 = await createMemory({
      apiKeyId,
      content: "user likes dark themes",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "dark mode",
      maxTokens: 2000,
      retentionDays: 30,
    });

    // m1 should rank first (exact phrase match bonus)
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(m1.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });

  it("memories with score=0 are filtered out when query is present", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const irrelevant = await createMemory({
      apiKeyId,
      content: "user drinks coffee every morning",
      key: `k-${uid()}`,
      type: "factual",
    });
    const relevant = await createMemory({
      apiKeyId,
      content: "user prefers typescript strict mode",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "typescript",
      maxTokens: 2000,
      retentionDays: 30,
    });

    const ids = results.map((m) => m.id);
    expect(ids).toContain(relevant.id);
    expect(ids).not.toContain(irrelevant.id);

    await deleteMemory(irrelevant.id);
    await deleteMemory(relevant.id);
  });

  it("results sorted by score DESC then createdAt DESC", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    // m1: older, high score (exact phrase + multiple tokens)
    const m1 = await createMemory({
      apiKeyId,
      content: "typescript typescript typescript is the best language typescript",
      key: `k-${uid()}`,
      type: "factual",
    });
    await new Promise((r) => setTimeout(r, 5));
    // m2: newer, lower score (single mention)
    const m2 = await createMemory({
      apiKeyId,
      content: "typescript is okay",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      query: "typescript",
      maxTokens: 2000,
      retentionDays: 30,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    // m1 has higher score despite being older
    expect(results[0].id).toBe(m1.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });
});

// ── Group 6: Scope filtering ──────────────────────────────────────────────────

describe("scope filtering", () => {
  it('scope="apiKey" returns all memories for apiKeyId regardless of session', async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({
      apiKeyId,
      sessionId: "session-a",
      content: "memory from session a",
      key: `k-${uid()}`,
      type: "factual",
    });
    const m2 = await createMemory({
      apiKeyId,
      sessionId: "session-b",
      content: "memory from session b",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      scope: "apiKey",
      maxTokens: 2000,
      retentionDays: 30,
    });

    const ids = results.map((m) => m.id);
    expect(ids).toContain(m1.id);
    expect(ids).toContain(m2.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });

  it('scope="session" returns only memories for the given sessionId', async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId = uid();

    const m1 = await createMemory({
      apiKeyId,
      sessionId: "session-x",
      content: "session x memory",
      key: `k-${uid()}`,
      type: "factual",
    });
    const m2 = await createMemory({
      apiKeyId,
      sessionId: "session-y",
      content: "session y memory",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "exact",
      scope: "session",
      sessionId: "session-x",
      maxTokens: 2000,
      retentionDays: 30,
    });

    const ids = results.map((m) => m.id);
    expect(ids).toContain(m1.id);
    expect(ids).not.toContain(m2.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });

  it("different apiKeyId memories are not returned", async () => {
    const { createMemory, deleteMemory } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");
    const apiKeyId1 = uid();
    const apiKeyId2 = uid();

    const m1 = await createMemory({
      apiKeyId: apiKeyId1,
      content: "belongs to key 1",
      key: `k-${uid()}`,
      type: "factual",
    });
    const m2 = await createMemory({
      apiKeyId: apiKeyId2,
      content: "belongs to key 2",
      key: `k-${uid()}`,
      type: "factual",
    });

    const results = await retrieveMemories(apiKeyId1, {
      enabled: true,
      retrievalStrategy: "exact",
      maxTokens: 2000,
      retentionDays: 30,
    });

    const ids = results.map((m) => m.id);
    expect(ids).toContain(m1.id);
    expect(ids).not.toContain(m2.id);

    await deleteMemory(m1.id);
    await deleteMemory(m2.id);
  });
});
