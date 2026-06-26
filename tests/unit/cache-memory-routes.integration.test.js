import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-routes-test-"));
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

describe("cache/memory routes integration", () => {
  it("updates and returns cache config settings", async () => {
    const cacheConfigRoute = await import("@/app/api/settings/cache-config/route.js");

    const putReq = new Request("http://localhost/api/settings/cache-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        semanticCacheEnabled: true,
        semanticCacheMaxSize: 123,
        semanticCacheTTL: 456789,
      }),
    });
    const putRes = await cacheConfigRoute.PUT(putReq);
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json();
    expect(putJson.ok).toBe(true);

    const getRes = await cacheConfigRoute.GET(new Request("http://localhost/api/settings/cache-config"));
    expect(getRes.status).toBe(200);
    const config = await getRes.json();
    expect(config.semanticCacheEnabled).toBe(true);
    expect(config.semanticCacheMaxSize).toBe(123);
    expect(config.semanticCacheTTL).toBe(456789);
  });

  it("updates and returns memory settings", async () => {
    const memorySettingsRoute = await import("@/app/api/settings/memory/route.js");

    const putReq = new Request("http://localhost/api/settings/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        maxTokens: 1500,
        retentionDays: 20,
        strategy: "hybrid",
      }),
    });
    const putRes = await memorySettingsRoute.PUT(putReq);
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json();
    expect(putJson.enabled).toBe(true);
    expect(putJson.maxTokens).toBe(1500);
    expect(putJson.retentionDays).toBe(20);
    expect(putJson.strategy).toBe("hybrid");

    const getRes = await memorySettingsRoute.GET(new Request("http://localhost/api/settings/memory"));
    expect(getRes.status).toBe(200);
    const settings = await getRes.json();
    expect(settings.enabled).toBe(true);
    expect(settings.maxTokens).toBe(1500);
  });

  it("supports memory CRUD via API routes", async () => {
    const memoryRoute = await import("@/app/api/memory/route.js");
    const memoryByIdRoute = await import("@/app/api/memory/[id]/route.js");

    const postReq = new Request("http://localhost/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKeyId: "route-key-1",
        sessionId: "route-s1",
        type: "factual",
        key: "pref:lang",
        content: "User prefers Indonesian language",
      }),
    });
    const postRes = await memoryRoute.POST(postReq);
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.success).toBe(true);
    const memoryId = postJson.data.id;

    const listRes = await memoryRoute.GET(new Request("http://localhost/api/memory?apiKeyId=route-key-1"));
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.total).toBeGreaterThanOrEqual(1);

    const getByIdRes = await memoryByIdRoute.GET(new Request(`http://localhost/api/memory/${memoryId}`), {
      params: { id: memoryId },
    });
    expect(getByIdRes.status).toBe(200);
    const fetched = await getByIdRes.json();
    expect(fetched.id).toBe(memoryId);

    const patchRes = await memoryByIdRoute.PATCH(
      new Request(`http://localhost/api/memory/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "User prefers Bahasa Indonesia" }),
      }),
      { params: { id: memoryId } },
    );
    if (patchRes.status !== 200) {
      console.log("PATCH memory error:", await patchRes.clone().text());
    }
    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.success).toBe(true);
    expect(String(patchJson.data.content)).toContain("Bahasa Indonesia");
  });

  it("returns cache stats endpoint shape", async () => {
    const cacheRoute = await import("@/app/api/cache/route.js");
    const { generateSignature, setCachedResponse } = await import("@/lib/semanticCache.js");

    const signature = generateSignature("test/model", [{ role: "user", content: "hello cache" }], 0, 1);
    setCachedResponse(signature, "test/model", {
      id: "cmpl-cache",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "cached response" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });

    const getRes = await cacheRoute.GET(new Request("http://localhost/api/cache"));
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data.semanticCache).toBeTruthy();
    expect(typeof data.semanticCache.memoryEntries).toBe("number");
    expect(typeof data.config.semanticCacheEnabled).toBe("boolean");
  });
});
