import crypto from "node:crypto";
import { LRUCache } from "../cacheLayer.js";
import { getDatabase, tx } from "../sqlite/connection.js";
import { MEMORY_TYPES, MemoryType } from "./types.js";

const MEMORY_CACHE_TTL = 300_000;
// Use LRUCache instead of plain Map: bounded by size + bytes + TTL,
// no manual eviction needed, no unbounded growth under write-heavy load.
const memoryCache = new LRUCache({
  maxSize: 500,
  maxBytes: 4 * 1024 * 1024, // 4 MB
  defaultTTL: MEMORY_CACHE_TTL,
});

function setCache(cacheKey, value) {
  memoryCache.set(cacheKey, value);
}

function getCache(cacheKey) {
  return memoryCache.get(cacheKey); // undefined on miss or expired
}

function parseJSON(value) {
  if (!value || typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function rowToMemory(row) {
  return {
    id: String(row.id),
    apiKeyId: String(row.api_key_id),
    sessionId: typeof row.session_id === "string" ? row.session_id : "",
    type: String(row.type),
    key: typeof row.key === "string" ? row.key : "",
    content: String(row.content || ""),
    metadata: parseJSON(row.metadata),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
  };
}

function findExistingMemory(db, apiKeyId, key) {
  if (!key) return undefined;
  const stmt = db.prepare("SELECT * FROM memories WHERE api_key_id = ? AND key = ? ORDER BY created_at DESC LIMIT 1");
  return stmt.get(apiKeyId, key);
}

export async function createMemory(memory) {
  const now = new Date().toISOString();
  const type = MEMORY_TYPES.has(memory?.type) ? memory.type : MemoryType.FACTUAL;
  const key = typeof memory?.key === "string" ? memory.key.trim() : "";
  const apiKeyId = String(memory?.apiKeyId || "");
  if (!apiKeyId) throw new Error("apiKeyId is required");
  if (!memory?.content || typeof memory.content !== "string") throw new Error("content is required");

  // Run the SELECT-then-INSERT/UPDATE inside a transaction to prevent
  // duplicate memory entries from concurrent calls with the same key.
  return tx((db) => {
    const existing = key ? findExistingMemory(db, apiKeyId, key) : undefined;
    if (existing) {
      const mergedMetadata = { ...parseJSON(existing.metadata), ...(memory.metadata || {}) };
      db.prepare(
        "UPDATE memories SET content = ?, metadata = ?, updated_at = ?, session_id = ?, type = ?, expires_at = ? WHERE id = ?",
      ).run(
        memory.content,
        JSON.stringify(mergedMetadata),
        now,
        memory.sessionId || null,
        type,
        memory.expiresAt ? new Date(memory.expiresAt).toISOString() : null,
        existing.id,
      );
      memoryCache.delete(`id:${existing.id}`);
      return {
        id: String(existing.id),
        apiKeyId,
        sessionId: memory.sessionId || "",
        type,
        key,
        content: memory.content,
        metadata: mergedMetadata,
        createdAt: new Date(String(existing.created_at)),
        updatedAt: new Date(now),
        expiresAt: memory.expiresAt ? new Date(memory.expiresAt) : null,
      };
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO memories
      (id, api_key_id, session_id, type, key, content, metadata, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      apiKeyId,
      memory.sessionId || null,
      type,
      key || null,
      memory.content,
      JSON.stringify(memory.metadata || {}),
      now,
      now,
      memory.expiresAt ? new Date(memory.expiresAt).toISOString() : null,
    );

    const created = {
      id,
      apiKeyId,
      sessionId: memory.sessionId || "",
      type,
      key,
      content: memory.content,
      metadata: memory.metadata || {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
      expiresAt: memory.expiresAt ? new Date(memory.expiresAt) : null,
    };
    setCache(`id:${id}`, created);
    return created;
  });
}

export async function getMemory(id) {
  if (!id) return null;
  const cacheKey = `id:${id}`;
  const cached = getCache(cacheKey);
  if (cached !== undefined) return cached;

  const db = getDatabase();
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  if (!row) {
    setCache(cacheKey, null);
    return null;
  }
  const memory = rowToMemory(row);
  setCache(cacheKey, memory);
  return memory;
}

export async function updateMemory(id, updates = {}) {
  if (!id) return false;
  const db = getDatabase();
  const now = new Date().toISOString();
  const fields = [];
  const values = [];

  if (updates.type !== undefined && MEMORY_TYPES.has(updates.type)) {
    fields.push("type = ?");
    values.push(updates.type);
  }
  if (updates.key !== undefined) {
    fields.push("key = ?");
    values.push(updates.key || null);
  }
  if (updates.content !== undefined) {
    fields.push("content = ?");
    values.push(updates.content);
  }
  if (updates.metadata !== undefined) {
    fields.push("metadata = ?");
    values.push(JSON.stringify(updates.metadata || {}));
  }
  if (updates.expiresAt !== undefined) {
    fields.push("expires_at = ?");
    values.push(updates.expiresAt ? new Date(updates.expiresAt).toISOString() : null);
  }
  if (updates.sessionId !== undefined) {
    fields.push("session_id = ?");
    values.push(updates.sessionId || null);
  }

  if (fields.length === 0) return false;
  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);

  const result = db.prepare(`UPDATE memories SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  memoryCache.delete(`id:${id}`);
  return (result.changes || 0) > 0;
}

export async function deleteMemory(id) {
  if (!id) return false;
  const db = getDatabase();
  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  memoryCache.delete(`id:${id}`);
  return (result.changes || 0) > 0;
}

export async function clearMemories(apiKeyId = null) {
  const db = getDatabase();
  const hasApiKeyScope = typeof apiKeyId === "string" && apiKeyId.trim().length > 0;
  const result = hasApiKeyScope
    ? db.prepare("DELETE FROM memories WHERE api_key_id = ?").run(apiKeyId)
    : db.prepare("DELETE FROM memories").run();
  memoryCache.clear();
  return result.changes || 0;
}

export async function listMemories(options = {}) {
  const db = getDatabase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const offset = Math.max(0, Number(options.offset) || 0);
  const clauses = ["1=1"];
  const params = [];

  if (options.apiKeyId) {
    clauses.push("api_key_id = ?");
    params.push(options.apiKeyId);
  }
  if (options.sessionId) {
    clauses.push("session_id = ?");
    params.push(options.sessionId);
  }
  if (options.type && MEMORY_TYPES.has(options.type)) {
    clauses.push("type = ?");
    params.push(options.type);
  }
  clauses.push("(expires_at IS NULL OR datetime(expires_at) > datetime('now'))");

  let rows = [];
  if (options.query && String(options.query).trim()) {
    const whereSql = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
    try {
      rows = db
        .prepare(
          `SELECT m.* FROM memories m
           JOIN memory_fts f ON m.rowid = f.rowid
           WHERE f.memory_fts MATCH ?${whereSql}
           ORDER BY m.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(String(options.query), ...params, limit, offset);
    } catch {
      rows = db
        .prepare(
          `SELECT * FROM memories WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
    }
  } else {
    rows = db
      .prepare(
        `SELECT * FROM memories
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
  }

  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${clauses.join(" AND ")}`).get(...params);
  const typeRows = db
    .prepare(`SELECT type, COUNT(*) AS count FROM memories WHERE ${clauses.join(" AND ")} GROUP BY type`)
    .all(...params);

  const byType = {};
  for (const row of typeRows) byType[String(row.type)] = Number(row.count || 0);

  return {
    data: rows.map(rowToMemory),
    total: Number(countRow?.count || 0),
    byType,
  };
}

/**
 * Returns memory store LRU cache stats for monitoring.
 */
export function getMemoryStoreStats() {
  return memoryCache.getStats();
}
