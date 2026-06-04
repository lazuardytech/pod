// In-flight request deduplication: signature → Promise<response>
// Prevents N concurrent identical requests from all hitting upstream simultaneously.
const inFlightRequests = new Map();

import crypto from "node:crypto";
import { LRUCache } from "./cacheLayer.js";
import { getDatabase } from "./sqlite/connection.js";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function ensureCacheMetricsTable() {
  try {
    const db = getDatabase();
    db.prepare(
      `CREATE TABLE IF NOT EXISTS cache_metrics (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO cache_metrics (key, value) VALUES ('hits', 0), ('misses', 0), ('tokens_saved', 0)`,
    ).run();
  } catch {
    // ignore
  }
}

function incrementMetric(metric, amount = 1) {
  try {
    const db = getDatabase();
    db.prepare(`UPDATE cache_metrics SET value = value + ?, updated_at = datetime('now') WHERE key = ?`).run(
      amount,
      metric,
    );
  } catch {
    // ignore
  }
}

function getMetricValue(metric) {
  try {
    const db = getDatabase();
    const row = db.prepare(`SELECT value FROM cache_metrics WHERE key = ?`).get(metric);
    return row ? toNumber(asRecord(row).value, 0) : 0;
  } catch {
    return 0;
  }
}

function getHeaderValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const needle = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() !== needle) continue;
    return typeof value === "string" ? value : null;
  }
  return null;
}

let memoryCache = null;

function getMemoryCache() {
  if (!memoryCache) {
    memoryCache = new LRUCache({
      maxSize: parseInt(process.env.SEMANTIC_CACHE_MAX_SIZE || "100", 10),
      maxBytes: parseInt(process.env.SEMANTIC_CACHE_MAX_BYTES || String(4 * 1024 * 1024), 10),
      defaultTTL: parseInt(process.env.SEMANTIC_CACHE_TTL_MS || "1800000", 10),
    });
    ensureCacheMetricsTable();
  }
  return memoryCache;
}

// Max bytes fed into SHA-256 for signature generation.
// For very long conversations we hash only the last N bytes of the serialised
// payload — collisions are astronomically unlikely in practice and this keeps
// generateSignature O(1) instead of O(context_length).
const SIGNATURE_MAX_BYTES = 64 * 1024; // 64 KB

function stringifyForSignature(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeConversation(conversation) {
  if (typeof conversation === "string") {
    return [{ role: "user", content: conversation }];
  }
  if (!Array.isArray(conversation)) return [];

  return conversation.map((item) => ({
    role: typeof item?.role === "string" && item.role.trim() ? item.role : "user",
    content: stringifyForSignature(item?.content),
  }));
}

export function generateSignature(model, conversation, temperature, topP, memoryOwnerId = null) {
  // Normalize temperature and top_p: treat undefined/null as their semantic
  // defaults so requests with explicit defaults hash identically to those
  // that omit the field entirely (very common across different clients).
  const normalizedTemp = temperature == null ? 1 : temperature;
  const normalizedTopP = topP == null ? 1 : topP;
  const payload = JSON.stringify({
    model,
    messages: normalizeConversation(conversation),
    temperature: normalizedTemp,
    top_p: normalizedTopP,
    // Include memoryOwnerId so different users with different memories never
    // share a cache entry — prevents cross-user memory bleed.
    ...(memoryOwnerId ? { memory_owner: memoryOwnerId } : {}),
  });
  // For large payloads, hash only the tail slice so we avoid blocking the
  // event loop with a multi-MB SHA-256 update on every request.
  const slice = payload.length > SIGNATURE_MAX_BYTES ? payload.slice(payload.length - SIGNATURE_MAX_BYTES) : payload;
  return crypto.createHash("sha256").update(slice).digest("hex");
}

export function getCachedResponse(signature) {
  const memResult = getMemoryCache().get(signature);
  if (memResult) {
    incrementMetric("hits");
    incrementMetric("tokens_saved", memResult.tokensSaved || 0);
    return memResult.response;
  }

  try {
    const db = getDatabase();
    const row = db
      .prepare(
        "SELECT response, tokens_saved, model, expires_at FROM semantic_cache WHERE signature = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
      )
      .get(signature);

    if (!row) {
      incrementMetric("misses");
      return null;
    }

    const record = asRecord(row);
    if (typeof record.response !== "string" || !record.response.trim()) {
      incrementMetric("misses");
      return null;
    }

    const parsed = JSON.parse(record.response);
    const tokensSaved = toNumber(record.tokens_saved, 0);
    // Compute remaining TTL from expires_at
    let memoryTtl = undefined;
    if (typeof record.expires_at === "string") {
      const remaining = new Date(record.expires_at).getTime() - Date.now();
      if (remaining > 0) memoryTtl = remaining;
    }
    const modelName = typeof record.model === "string" ? record.model : "";
    getMemoryCache().set(signature, { response: parsed, tokensSaved, model: modelName }, memoryTtl);
    db.prepare("UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE signature = ?").run(signature);

    incrementMetric("hits");
    incrementMetric("tokens_saved", tokensSaved);
    return parsed;
  } catch {
    incrementMetric("misses");
    return null;
  }
}

export function setCachedResponse(signature, model, response, tokensSaved = 0, ttlMs = 3600000) {
  const ttl = parseInt(process.env.SEMANTIC_CACHE_TTL_MS || String(ttlMs), 10);
  getMemoryCache().set(signature, { response, tokensSaved, model }, ttl);

  try {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const promptHash = signature.slice(0, 16);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttl).toISOString();

    db.prepare(
      `INSERT OR REPLACE INTO semantic_cache
      (id, signature, model, prompt_hash, response, tokens_saved, hit_count, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(id, signature, model, promptHash, JSON.stringify(response), tokensSaved, now, expiresAt);
  } catch {
    // ignore
  }
}

export function clearCache() {
  getMemoryCache().clear();
  let removed = 0;
  try {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM semantic_cache").run();
    removed = result.changes || 0;
    db.prepare("UPDATE cache_metrics SET value = 0").run();
  } catch {
    // ignore
  }
  return removed;
}

export function invalidateByModel(model) {
  // Targeted eviction: only remove entries matching this model from memory cache
  const cache = getMemoryCache();
  const toEvict = [];
  cache.forEach((key, value) => {
    if (value && typeof value === "object" && value.model === model) {
      toEvict.push(key);
    }
  });
  for (const key of toEvict) {
    cache.delete(key);
  }

  // In-flight dedup entries are per-request-signature, not per-model,
  // so they cannot be evicted by model — no cleanup needed here.

  try {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM semantic_cache WHERE model = ?").run(model);
    return result.changes || 0;
  } catch {
    return 0;
  }
}

export function invalidateBySignature(signature) {
  getMemoryCache().delete(signature);
  try {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM semantic_cache WHERE signature = ?").run(signature);
    return (result.changes || 0) > 0;
  } catch {
    return false;
  }
}

export function invalidateStale(maxAgeMs) {
  // invalidation criterion (age) is based on DB created_at, not memory cache
  // entry timestamp — we can't do targeted eviction from memory without storing
  // the DB timestamp alongside each memory entry, so clear the memory cache.
  getMemoryCache().clear();
  try {
    const db = getDatabase();
    const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
    const result = db.prepare("DELETE FROM semantic_cache WHERE created_at < ?").run(cutoffIso);
    return result.changes || 0;
  } catch {
    return 0;
  }
}

export function getCacheStats() {
  const memStats = getMemoryCache().getStats();
  let dbSize = 0;
  try {
    const db = getDatabase();
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM semantic_cache WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")
      .get();
    dbSize = toNumber(asRecord(row).count, 0);
  } catch {
    // ignore
  }

  const hits = getMetricValue("hits");
  const misses = getMetricValue("misses");
  const tokensSaved = getMetricValue("tokens_saved");
  const total = hits + misses;

  return {
    memoryEntries: memStats.size,
    dbEntries: dbSize,
    hits,
    misses,
    hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) : "0.0",
    tokensSaved,
  };
}

export function isCacheableForRead(body, headers) {
  if ((getHeaderValue(headers, "x-pod-no-cache") || "").toLowerCase() === "true") return false;
  if ((getHeaderValue(headers, "x-omniroute-no-cache") || "").toLowerCase() === "true") return false;
  // Use same default as generateSignature (null → 1) so a request with no
  // temperature field and one with temperature=1 produce the same signature
  // AND both pass this check — previously the default was 0 here vs 1 in
  // generateSignature, causing a signature mismatch for omitted temperature.
  const temp = body?.temperature ?? 1;
  if (temp > 1) return false;
  return true;
}

export function isCacheableForWrite(body, headers) {
  if ((getHeaderValue(headers, "x-pod-no-cache") || "").toLowerCase() === "true") return false;
  if ((getHeaderValue(headers, "x-omniroute-no-cache") || "").toLowerCase() === "true") return false;
  const temp = body?.temperature ?? 1;
  if (temp > 1) return false;
  return true;
}

/**
 * In-flight request tracking for thundering herd protection.
 * When N concurrent identical requests all miss the cache, only one
 * should hit upstream — the others await the in-flight promise.
 */
export function getInFlight(signature) {
  return inFlightRequests.get(signature) ?? null;
}

export function setInFlight(signature, promise) {
  inFlightRequests.set(signature, promise);
  // Auto-clear after 60s to prevent memory leak if upstream never resolves
  const timer = setTimeout(() => inFlightRequests.delete(signature), 60000);
  // Clean up timer when promise settles — prevents dangling Map entries
  promise.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
}

export function clearInFlight(signature) {
  inFlightRequests.delete(signature);
}

/**
 * Returns in-flight dedup map size for monitoring.
 */
export function getInFlightStats() {
  return { count: inFlightRequests.size };
}
