import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-memory-test-"));
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

describe("memory integration", () => {
  it("creates/lists memories and retrieves with semantic strategy", async () => {
    const { createMemory, clearMemories, listMemories } = await import("@/lib/memory/store.js");
    const { retrieveMemories } = await import("@/lib/memory/retrieval.js");

    const apiKeyId = "test-key-1";
    await clearMemories(apiKeyId);

    await createMemory({
      apiKeyId,
      sessionId: "s1",
      type: "factual",
      key: "pref:editor",
      content: "User prefers using TypeScript for backend services",
      metadata: { source: "test" },
      expiresAt: null,
    });
    await createMemory({
      apiKeyId,
      sessionId: "s1",
      type: "episodic",
      key: "decision:db",
      content: "User decided to use SQLite for local development",
      metadata: { source: "test" },
      expiresAt: null,
    });

    const listed = await listMemories({ apiKeyId, limit: 10, offset: 0 });
    expect(listed.total).toBeGreaterThanOrEqual(2);
    expect(listed.data.length).toBeGreaterThanOrEqual(2);

    const semantic = await retrieveMemories(apiKeyId, {
      enabled: true,
      retrievalStrategy: "semantic",
      query: "TypeScript",
      maxTokens: 2000,
      retentionDays: 30,
      scope: "apiKey",
    });
    expect(semantic.length).toBeGreaterThan(0);
    expect(semantic.some((m) => String(m.content).includes("TypeScript"))).toBe(true);
  });

  it("injects memory context into outgoing messages", async () => {
    const { injectMemory } = await import("@/lib/memory/injection.js");
    const request = {
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    };
    const memories = [{ content: "User likes concise answers" }, { content: "User uses pnpm" }];

    const injected = injectMemory(request, memories, "openai");
    expect(injected.messages[0].role).toBe("system");
    expect(injected.messages[0].content).toContain("Memory context:");
    expect(injected.messages[0].content).toContain("User likes concise answers");
  });

  it("extracts facts asynchronously and stores them", async () => {
    const { clearMemories, listMemories } = await import("@/lib/memory/store.js");
    const { extractFacts } = await import("@/lib/memory/extraction.js");
    const apiKeyId = "test-key-2";
    await clearMemories(apiKeyId);

    extractFacts("I prefer dark mode and I will use pnpm for this project.", apiKeyId, "session-x");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const listed = await listMemories({ apiKeyId, limit: 50, offset: 0 });
    expect(listed.total).toBeGreaterThan(0);
    expect(listed.data.some((m) => String(m.content).toLowerCase().includes("dark mode"))).toBe(true);
  });
});
