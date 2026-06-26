import * as log from "../utils/logger.js";

// Request-scoped cache for getMachineData (avoids multiple D1 queries per request)
// Capped at 500 entries to prevent unbounded growth across long-lived isolates
const requestCache = new Map<string, { data: Record<string, unknown>; timestamp: number }>();
const CACHE_TTL_MS = 5000;
const MAX_CACHE_ENTRIES = 500;

function evictOldestIfNeeded(): void {
  if (requestCache.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of requestCache.entries()) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) requestCache.delete(oldestKey);
}

/**
 * Get machine data from D1 (with request-scope caching)
 */
export async function getMachineData(machineId: string, env: Env): Promise<Record<string, unknown> | null> {
  const cached = requestCache.get(machineId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const row = await env.DB.prepare("SELECT data FROM machines WHERE machineId = ?")
    .bind(machineId)
    .first<{ data: string }>();

  if (!row) {
    log.debug("STORAGE", `Not found: ${machineId}`);
    return null;
  }

  const data = JSON.parse(row.data) as Record<string, unknown>;
  evictOldestIfNeeded();
  requestCache.set(machineId, { data, timestamp: Date.now() });
  log.debug("STORAGE", `Retrieved: ${machineId}`);
  return data;
}

/**
 * Save machine data to D1
 */
export async function saveMachineData(machineId: string, data: Record<string, unknown>, env: Env): Promise<void> {
  const now = new Date().toISOString();
  data.updatedAt = now;

  // Upsert to D1
  await env.DB.prepare(`
    INSERT INTO machines (machineId, data, updatedAt) 
    VALUES (?, ?, ?)
    ON CONFLICT(machineId) DO UPDATE SET data = ?, updatedAt = ?
  `)
    .bind(machineId, JSON.stringify(data), now, JSON.stringify(data), now)
    .run();

  // Update cache after save
  evictOldestIfNeeded();
  requestCache.set(machineId, { data, timestamp: Date.now() });
  log.debug("STORAGE", `Saved: ${machineId}`);
}

/**
 * Delete machine data from D1
 */
export async function deleteMachineData(machineId: string, env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM machines WHERE machineId = ?")
    .bind(machineId)
    .run();

  // Clear cache after delete
  requestCache.delete(machineId);
  log.debug("STORAGE", `Deleted: ${machineId}`);
}

/**
 * Update specific fields in machine data (for token refresh, rate limit, etc.)
 */
export async function updateMachineProvider(machineId: string, connectionId: string, updates: Record<string, unknown>, env: Env): Promise<void> {
  const data = await getMachineData(machineId, env);
  const providers = data?.providers as Record<string, Record<string, unknown>> | undefined;
  if (!providers?.[connectionId]) return;

  Object.assign(providers[connectionId], updates);
  providers[connectionId].updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data!, env);
}
