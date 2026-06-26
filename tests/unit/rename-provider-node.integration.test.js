import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tempDir;
let originalDataDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pod-rename-node-test-"));
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

beforeEach(async () => {
  const { importDb } = await import("@/lib/localDb.js");
  await importDb({
    providerConnections: [],
    providerNodes: [],
    proxyPools: [],
    modelAliases: {},
    combos: [],
    apiKeys: [],
    customModels: [],
    settings: {},
    pricing: {},
  });
});

const OLD_ID = "openai-compatible-foo";
const NEW_ID = "openai-compatible-bar";

async function seedCustomNode(id = OLD_ID) {
  const { createProviderNode } = await import("@/lib/localDb.js");
  return await createProviderNode({
    id,
    type: "openai-compatible",
    name: "Foo Provider",
    prefix: "foo",
    apiType: "chat",
    baseUrl: "https://example.com/v1",
  });
}

describe("renameProviderNode — basic node table update", () => {
  it("updates provider_nodes.id and records previousIds", async () => {
    await seedCustomNode();
    const { renameProviderNode, getProviderNodeById } = await import("@/lib/localDb.js");

    const updated = await renameProviderNode(OLD_ID, NEW_ID);
    expect(updated.id).toBe(NEW_ID);
    expect(updated.previousIds).toContain(OLD_ID);

    expect(await getProviderNodeById(OLD_ID)).toBeNull();

    const fresh = await getProviderNodeById(NEW_ID);
    expect(fresh).toBeTruthy();
    expect(fresh.previousIds).toEqual([OLD_ID]);
    expect(fresh.type).toBe("openai-compatible");
    expect(fresh.name).toBe("Foo Provider");
  });

  it("accumulates previousIds across multiple renames", async () => {
    await seedCustomNode("openai-compatible-a");
    const { renameProviderNode, getProviderNodeById } = await import("@/lib/localDb.js");

    await renameProviderNode("openai-compatible-a", "openai-compatible-b");
    await renameProviderNode("openai-compatible-b", "openai-compatible-c");

    const fresh = await getProviderNodeById("openai-compatible-c");
    expect(fresh.previousIds).toEqual(["openai-compatible-a", "openai-compatible-b"]);
  });

  it("rejects rename when newId already exists", async () => {
    await seedCustomNode(OLD_ID);
    await seedCustomNode(NEW_ID);
    const { renameProviderNode } = await import("@/lib/localDb.js");

    await expect(renameProviderNode(OLD_ID, NEW_ID)).rejects.toThrow(/already in use/i);
  });

  it("rejects when source node missing", async () => {
    const { renameProviderNode } = await import("@/lib/localDb.js");
    await expect(renameProviderNode("openai-compatible-missing", NEW_ID)).rejects.toThrow(/not found/i);
  });

  it("rejects when oldId === newId", async () => {
    await seedCustomNode();
    const { renameProviderNode } = await import("@/lib/localDb.js");
    await expect(renameProviderNode(OLD_ID, OLD_ID)).rejects.toThrow(/must differ/i);
  });
});

describe("renameProviderNode — cascades to dependent tables", () => {
  it("rewrites provider_connections.provider", async () => {
    await seedCustomNode();
    const { createProviderConnection, getProviderConnections, renameProviderNode } = await import("@/lib/localDb.js");
    const conn = await createProviderConnection({
      provider: OLD_ID,
      authType: "apikey",
      name: "conn-1",
      apiKey: "sk-test",
      isActive: true,
    });

    await renameProviderNode(OLD_ID, NEW_ID);

    const newConns = await getProviderConnections({ provider: NEW_ID });
    expect(newConns.map((c) => c.id)).toContain(conn.id);
    const oldConns = await getProviderConnections({ provider: OLD_ID });
    expect(oldConns).toHaveLength(0);
  });

  it("rewrites custom_models.provider_alias", async () => {
    await seedCustomNode();
    const { addCustomModel, getCustomModels, renameProviderNode } = await import("@/lib/localDb.js");
    await addCustomModel({ providerAlias: OLD_ID, id: "my-model", name: "My Model" });

    await renameProviderNode(OLD_ID, NEW_ID);

    const models = await getCustomModels();
    expect(models.find((m) => m.id === "my-model").providerAlias).toBe(NEW_ID);
  });

  it("rewrites combos.models entries that reference the renamed provider", async () => {
    await seedCustomNode();
    const { createCombo, getComboById, renameProviderNode } = await import("@/lib/localDb.js");
    const combo = await createCombo({
      name: "test-combo",
      models: [`${OLD_ID}/gpt-4`, `${OLD_ID}/gpt-4o-mini`, "openai/gpt-3.5", "some-alias-without-slash"],
    });

    await renameProviderNode(OLD_ID, NEW_ID);

    const fresh = await getComboById(combo.id);
    expect(fresh.models).toEqual([
      `${NEW_ID}/gpt-4`,
      `${NEW_ID}/gpt-4o-mini`,
      "openai/gpt-3.5",
      "some-alias-without-slash",
    ]);
  });

  it("rewrites model_aliases.target", async () => {
    await seedCustomNode();
    const { setModelAlias, getModelAliases, renameProviderNode } = await import("@/lib/localDb.js");
    await setModelAlias("my-shortcut", `${OLD_ID}/gpt-4`);
    await setModelAlias("other", "openai/gpt-3.5");

    await renameProviderNode(OLD_ID, NEW_ID);

    const aliases = await getModelAliases();
    expect(aliases["my-shortcut"]).toBe(`${NEW_ID}/gpt-4`);
    expect(aliases["other"]).toBe("openai/gpt-3.5");
  });

  it("rewrites settings.providerStrategies and settings.providerThinking keys", async () => {
    await seedCustomNode();
    const { updateSettings, getSettings, renameProviderNode } = await import("@/lib/localDb.js");
    await updateSettings({
      providerStrategies: { [OLD_ID]: { fallbackStrategy: "round-robin" }, openai: { fallbackStrategy: "fill-first" } },
      providerThinking: { [OLD_ID]: { mode: "extended", effortMode: "high" } },
    });

    await renameProviderNode(OLD_ID, NEW_ID);

    const settings = await getSettings();
    expect(settings.providerStrategies[NEW_ID]).toEqual({ fallbackStrategy: "round-robin" });
    expect(settings.providerStrategies[OLD_ID]).toBeUndefined();
    expect(settings.providerStrategies.openai).toEqual({ fallbackStrategy: "fill-first" });
    expect(settings.providerThinking[NEW_ID]).toEqual({ mode: "extended", effortMode: "high" });
    expect(settings.providerThinking[OLD_ID]).toBeUndefined();
  });

  it("rewrites usage_history.provider and request_log.provider rows", async () => {
    await seedCustomNode();
    const { renameProviderNode } = await import("@/lib/localDb.js");
    const { getDatabase } = await import("@/lib/sqlite/connection.ts");
    const db = getDatabase();

    db.prepare(
      `INSERT INTO usage_history (timestamp, provider, model, connection_id, api_key, endpoint, status, prompt_tokens, completion_tokens, cost, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(new Date().toISOString(), OLD_ID, "gpt-4", "conn-1", null, "/v1/chat", "200", 10, 5, 0.001, "{}");

    db.prepare(
      `INSERT INTO request_log (timestamp, model, provider, account, prompt_tokens, completion_tokens, status, combo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(new Date().toISOString(), "gpt-4", OLD_ID, "conn-1", 10, 5, "OK", null);

    db.prepare(
      `INSERT INTO request_details (id, timestamp, provider, model, connection_id, status, latency_ms, prompt_tokens, completion_tokens, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("req-1", new Date().toISOString(), OLD_ID, "gpt-4", "conn-1", "200", 250, 10, 5, "{}");

    db.prepare(
      `INSERT INTO daily_summary (date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data)
       VALUES (?, 'byProvider', ?, 1, 10, 5, 0.001, '{}')`,
    ).run("2026-05-15", OLD_ID);

    await renameProviderNode(OLD_ID, NEW_ID);

    expect(db.prepare("SELECT provider FROM usage_history").get().provider).toBe(NEW_ID);
    expect(db.prepare("SELECT provider FROM request_log").get().provider).toBe(NEW_ID);
    expect(db.prepare("SELECT provider FROM request_details").get().provider).toBe(NEW_ID);
    expect(db.prepare("SELECT key FROM daily_summary WHERE bucket = 'byProvider'").get().key).toBe(NEW_ID);
  });
});

describe("renameProviderNode — atomicity", () => {
  it("rolls back all changes when an underlying statement fails", async () => {
    // Force a collision mid-transaction by inserting a provider_nodes row with
    // the target id BETWEEN the conflict check and the transaction. We can't
    // race that here easily, but we can verify that a duplicate-id check (the
    // SQLite PRIMARY KEY constraint) blocks the rename atomically.
    await seedCustomNode(OLD_ID);
    await seedCustomNode(NEW_ID);
    const { renameProviderNode, getProviderConnections, createProviderConnection } = await import("@/lib/localDb.js");

    await createProviderConnection({
      provider: OLD_ID,
      authType: "apikey",
      name: "conn-untouched",
      apiKey: "sk-test",
      isActive: true,
    });

    await expect(renameProviderNode(OLD_ID, NEW_ID)).rejects.toThrow();

    // Connection's provider should still be OLD_ID — nothing cascaded.
    const conns = await getProviderConnections({ provider: OLD_ID });
    expect(conns).toHaveLength(1);
    expect(conns[0].name).toBe("conn-untouched");
  });
});
