import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-semcache-test-"));
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

describe("semantic cache", () => {
  it("stores and retrieves cached response by signature", async () => {
    const { clearCache, generateSignature, getCachedResponse, setCachedResponse } =
      await import("@/lib/semanticCache.ts");
    clearCache();

    const payload = {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
    };
    const signature = generateSignature(payload.model, payload.messages, payload.temperature, 1);

    const response = {
      id: "chatcmpl-test",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    setCachedResponse(signature, payload.model, response, 15);

    const cached = getCachedResponse(signature);
    expect(cached).toBeTruthy();
    expect(cached.choices[0].message.content).toBe("hi");
  });

  it("supports invalidation by signature and by model", async () => {
    const {
      clearCache,
      generateSignature,
      getCachedResponse,
      invalidateByModel,
      invalidateBySignature,
      setCachedResponse,
    } = await import("@/lib/semanticCache.ts");
    clearCache();

    const sigA = generateSignature("m/a", [{ role: "user", content: "A" }], 0, 1);
    const sigB = generateSignature("m/b", [{ role: "user", content: "B" }], 0, 1);
    setCachedResponse(sigA, "m/a", { choices: [{ message: { content: "A" } }] }, 2);
    setCachedResponse(sigB, "m/b", { choices: [{ message: { content: "B" } }] }, 2);

    expect(invalidateBySignature(sigA)).toBe(true);
    expect(getCachedResponse(sigA)).toBeNull();
    expect(getCachedResponse(sigB)).toBeTruthy();

    expect(invalidateByModel("m/b")).toBeGreaterThanOrEqual(1);
    expect(getCachedResponse(sigB)).toBeNull();
  });

  it("applies cacheability rules correctly", async () => {
    const { isCacheableForRead, isCacheableForWrite } = await import("@/lib/semanticCache.ts");
    const baseBody = {
      stream: false,
      temperature: 0,
      messages: [{ role: "user", content: "hello" }],
    };

    expect(isCacheableForRead(baseBody, {})).toBe(true);
    expect(isCacheableForWrite(baseBody, {})).toBe(true);
    expect(isCacheableForRead({ ...baseBody, stream: true }, {})).toBe(true); // streaming now cacheable
    expect(isCacheableForWrite({ ...baseBody, stream: true }, {})).toBe(true); // streaming now cacheable
    expect(isCacheableForRead({ ...baseBody, temperature: 1 }, {})).toBe(true); // default temperature cacheable
    expect(isCacheableForWrite({ ...baseBody, temperature: 1 }, {})).toBe(true); // default temperature cacheable
    expect(isCacheableForRead({ ...baseBody, temperature: 0.5 }, {})).toBe(true); // <= 1 cacheable
    expect(isCacheableForWrite({ ...baseBody, temperature: 1.5 }, {})).toBe(false); // > 1 not cacheable
    expect(isCacheableForWrite({ ...baseBody, temperature: 0.2 }, {})).toBe(true);
    expect(isCacheableForRead(baseBody, { "x-pod-no-cache": "true" })).toBe(false);
  });
});
