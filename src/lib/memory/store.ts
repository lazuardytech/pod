import crypto from "node:crypto";
import { LRUCache } from "@/lib/cacheLayer";
import { getDatabase, tx } from "@/lib/sqlite/connection";
import { MEMORY_TYPES, MemoryType, type MemoryTypeValue } from "./types";

const MEMORY_CACHE_TTL = 300_000;
// Use LRUCache instead of plain Map: bounded by size + bytes + TTL,
// no manual eviction needed, no unbounded growth under write-heavy load.
const memoryCache = new LRUCache<unknown>({
  maxSize: 500,
  maxBytes: 4 * 1024 * 1024, // 4 MB
  defaultTTL: MEMORY_CACHE_TTL,
});

function setCache(cacheKey: string, value: unknown): void {
  memoryCache.set(cacheKey, value);
}

function getCache<T = unknown>(cacheKey: string): T | undefined {
  return memoryCache.get(cacheKey) as T | undefined;
}

function parseJSON(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type MemoryRow = {
  id: string;
  api_key_id: string;
  session_id: string | null;
  type: string;
  key: string | null;
  content: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

function rowToMemory(row: MemoryRow): MemoryRecord {
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

function findExistingMemory(db: ReturnType<typeof getDatabase>, apiKeyId: string, key: string): MemoryRow | undefined {
  if (!key) return undefined;
  const stmt = db.prepare("SELECT * FROM memories WHERE api_key_id = ? AND key = ? ORDER BY created_at DESC LIMIT 1");
  return stmt.get(apiKeyId, key) as MemoryRow | undefined;
}

export type MemoryRecord = {
  id: string;
  apiKeyId: string;
  sessionId: string;
  type: string;
  key: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};

export type CreateMemoryInput = {
  apiKeyId?: string;
  sessionId?: string;
  type?: string;
  key?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string | Date | null;
};

export async function createMemory(memory: CreateMemoryInput): Promise<MemoryRecord> {
  const now = new Date().toISOString();
  const requestedType = (memory?.type ?? "") as MemoryTypeValue;
  const type: string = MEMORY_TYPES.has(requestedType) ? requestedType : MemoryType.FACTUAL;
  const key = typeof memory?.key === "string" ? memory.key.trim() : "";
  const apiKeyId = String(memory?.apiKeyId || "");
  if (!apiKeyId) throw new Error("apiKeyId is required");
  if (!memory?.content || typeof memory.content !== "string") throw new Error("content is required");

  const content = memory.content;
  const metadata = memory.metadata;
  const sessionId = memory.sessionId;
  const expiresAt = memory.expiresAt;

  // Run the SELECT-then-INSERT/UPDATE inside a transaction to prevent
  // duplicate memory entries from concurrent calls with the same key.
  return tx((db) => {
    const existing = key ? findExistingMemory(db, apiKeyId, key) : undefined;
    if (existing) {
      const mergedMetadata = { ...parseJSON(existing.metadata), ...(metadata || {}) };
      db.prepare(
        "UPDATE memories SET content = ?, metadata = ?, updated_at = ?, session_id = ?, type = ?, expires_at = ? WHERE id = ?",
      ).run(
        content,
        JSON.stringify(mergedMetadata),
        now,
        sessionId || null,
        type,
        expiresAt ? new Date(expiresAt).toISOString() : null,
        existing.id,
      );
      memoryCache.delete(`id:${existing.id}`);
      return {
        id: String(existing.id),
        apiKeyId,
        sessionId: sessionId || "",
        type,
        key,
        content,
        metadata: mergedMetadata,
        createdAt: new Date(String(existing.created_at)),
        updatedAt: new Date(now),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
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
      sessionId || null,
      type,
      key || null,
      content,
      JSON.stringify(metadata || {}),
      now,
      now,
      expiresAt ? new Date(expiresAt).toISOString() : null,
    );

    const created: MemoryRecord = {
      id,
      apiKeyId,
      sessionId: sessionId || "",
      type,
      key,
      content,
      metadata: metadata || {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    };
    setCache(`id:${id}`, created);
    return created;
  });
}

export async function getMemory(id: string): Promise<MemoryRecord | null> {
  if (!id) return null;
  const cacheKey = `id:${id}`;
  const cached = getCache<MemoryRecord | null>(cacheKey);
  if (cached !== undefined) return cached;

  const db = getDatabase();
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
  if (!row) {
    setCache(cacheKey, null);
    return null;
  }
  const memory = rowToMemory(row);
  setCache(cacheKey, memory);
  return memory;
}

export async function updateMemory(
  id: string,
  updates: {
    type?: string;
    key?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    expiresAt?: string | Date | null;
    sessionId?: string;
  } = {},
): Promise<boolean> {
  if (!id) return false;
  const db = getDatabase();
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.type !== undefined && MEMORY_TYPES.has((updates.type as MemoryTypeValue) || ("" as MemoryTypeValue))) {
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

export async function deleteMemory(id: string): Promise<boolean> {
  if (!id) return false;
  const db = getDatabase();
  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  memoryCache.delete(`id:${id}`);
  return (result.changes || 0) > 0;
}

export async function clearMemories(apiKeyId: string | null = null): Promise<number> {
  const db = getDatabase();
  const hasApiKeyScope = typeof apiKeyId === "string" && apiKeyId.trim().length > 0;
  const result = hasApiKeyScope
    ? db.prepare("DELETE FROM memories WHERE api_key_id = ?").run(apiKeyId)
    : db.prepare("DELETE FROM memories").run();
  memoryCache.clear();
  return result.changes || 0;
}

export type ListMemoriesOptions = {
  apiKeyId?: string;
  sessionId?: string;
  type?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

export type ListMemoriesResult = {
  data: MemoryRecord[];
  total: number;
  byType: Record<string, number>;
};

export async function listMemories(options: ListMemoriesOptions = {}): Promise<ListMemoriesResult> {
  const db = getDatabase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const offset = Math.max(0, Number(options.offset) || 0);
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];

  if (options.apiKeyId) {
    clauses.push("api_key_id = ?");
    params.push(options.apiKeyId);
  }
  if (options.sessionId) {
    clauses.push("session_id = ?");
    params.push(options.sessionId);
  }
  if (options.type && MEMORY_TYPES.has((options.type as MemoryTypeValue) || ("" as MemoryTypeValue))) {
    clauses.push("type = ?");
    params.push(options.type);
  }
  clauses.push("(expires_at IS NULL OR datetime(expires_at) > datetime('now'))");

  let rows: MemoryRow[] = [];
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
        .all(String(options.query), ...params, limit, offset) as MemoryRow[];
    } catch {
      rows = db
        .prepare(
          `SELECT * FROM memories WHERE ${clauses.join(" AND ")}
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as MemoryRow[];
    }
  } else {
    rows = db
      .prepare(
        `SELECT * FROM memories
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as MemoryRow[];
  }

  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${clauses.join(" AND ")}`).get(...params) as
    | { count?: number }
    | undefined;
  const typeRows = db
    .prepare(`SELECT type, COUNT(*) AS count FROM memories WHERE ${clauses.join(" AND ")} GROUP BY type`)
    .all(...params) as Array<{ type: string; count: number }>;

  const byType: Record<string, number> = {};
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
export function getMemoryStoreStats(): ReturnType<LRUCache<unknown>["getStats"]> {
  return memoryCache.getStats();
}
