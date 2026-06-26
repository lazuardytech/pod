import fs from "node:fs";
import os from "node:os";
import { getPromptCache } from "@/lib/cacheLayer";
import {
  getApiKeys,
  getCombos,
  getProviderConnections,
  getProviderNodes,
  getSettings,
  type Settings,
} from "@/lib/localDb";
import { getMemoryStoreStats } from "@/lib/memory/store";
import { getSyncStatus as getModelsDevSyncStatus } from "@/lib/modelsDevSync";
import { sanitizeError } from "@/lib/sanitizeError";
import { getCacheStats, getInFlightStats } from "@/lib/semanticCache";
import { DATA_DIR, getDatabase, SQLITE_FILE } from "@/lib/sqlite/connection";
import { getConnectionNameCacheStats, getPendingStats, getQueueDepths } from "@/lib/usageDb";
import { APP_CONFIG } from "@/shared/constants/config";
import {
  AI_PROVIDERS,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getCloudSyncStatus } from "@/shared/services/cloudSyncScheduler";

// HMR-safe singleton: initialize ONCE on first import, survive hot reloads
function initStartTime(): number {
  const g = globalThis as Record<string, number | undefined>;
  if (g.__pod_start_time) return g.__pod_start_time;
  g.__pod_start_time = Date.now();
  return g.__pod_start_time;
}
const START_TIME = initStartTime();

// Cache integrity_check result — it's an O(n-pages) full scan, too expensive
// to run on every SSE poll. Re-run at most once every 5 minutes.
const INTEGRITY_CACHE_TTL_MS = 5 * 60 * 1000;
let _integrityCache: any = null;
let _integrityCacheAt = 0;

function getCachedIntegrity(db: any) {
  const now = Date.now();
  if (_integrityCache && now - _integrityCacheAt < INTEGRITY_CACHE_TTL_MS) {
    return _integrityCache;
  }
  const result = db.prepare("PRAGMA integrity_check").get();
  _integrityCache = result?.integrity_check ?? "ok";
  _integrityCacheAt = now;
  return _integrityCache;
}

function humanizeBytes(bytes: any) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getSystemInfo() {
  const mem = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  // Heap pressure: heapUsed / heapTotal. Clamp to [0, 1] because Bun can
  // report transient heapUsed > heapTotal during GC sweeps when external
  // ArrayBuffers / shared memory are accounted differently from V8.
  const rawHeapPressure = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;
  const heapPressure = Math.max(0, Math.min(1, rawHeapPressure));
  // RSS pressure: process resident size vs total system memory — closer to
  // what `docker stats` shows. Useful for OOM forecasting.
  const rssPressure = totalMemory > 0 ? Math.min(1, mem.rss / totalMemory) : 0;
  return {
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    nodeVersion: process.version,
    bunVersion: process.versions.bun ?? null,
    platform: process.platform,
    arch: process.arch,
    memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external ?? 0 },
    memoryUsageHumanized: {
      rss: humanizeBytes(mem.rss),
      heapUsed: humanizeBytes(mem.heapUsed),
      heapTotal: humanizeBytes(mem.heapTotal),
      external: humanizeBytes(mem.external ?? 0),
    },
    // Heap pressure (V8/JSCore heap saturation) — always 0..1.
    memoryPressure: Math.round(heapPressure * 10000) / 10000,
    memoryPressurePercent: `${(heapPressure * 100).toFixed(1)}%`,
    // RSS pressure (process vs system memory) — better leak indicator.
    rssPressure: Math.round(rssPressure * 10000) / 10000,
    rssPressurePercent: `${(rssPressure * 100).toFixed(1)}%`,
    freeMemory,
    totalMemory,
    loadAvg: os.loadavg(),
    cpus: os.cpus().length,
    processStartedAt: new Date(START_TIME).toISOString(),
  };
}

function getDbInfo() {
  try {
    const db = getDatabase();
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    const integrity = { integrity_check: getCachedIntegrity(db) };
    const pageCount = db.prepare("PRAGMA page_count").get();
    const pageSize = db.prepare("PRAGMA page_size").get();
    const walMode = db.prepare("PRAGMA journal_mode").get();
    return {
      ok: true,
      schemaVersion: version?.value ?? "unknown",
      integrity: integrity.integrity_check,
      sizeBytes: (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 4096),
      journalMode: walMode?.journal_mode ?? "unknown",
    };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

function getDataDirSizeBytes() {
  try {
    // Use the canonical SQLITE_FILE path resolved by sqlite/connection.js so
    // we report the actual file location, including DATA_DIR env override and
    // the read-only fallback path used in containers.
    if (fs.existsSync(SQLITE_FILE)) {
      let total = fs.statSync(SQLITE_FILE).size;
      // Add WAL + SHM if present (can be sizeable on a busy DB)
      for (const suffix of ["-wal", "-shm"]) {
        const f = SQLITE_FILE + suffix;
        try {
          if (fs.existsSync(f)) total += fs.statSync(f).size;
        } catch {}
      }
      return total;
    }
    return null;
  } catch {
    return null;
  }
}

function getDataDirPath() {
  try {
    return DATA_DIR;
  } catch {
    return null;
  }
}

export async function buildHealthPayload() {
  const system = getSystemInfo();
  const database = getDbInfo();

  const [connections, combos, apiKeys, settings, providerNodesResult] = await Promise.allSettled([
    getProviderConnections(),
    getCombos(),
    getApiKeys(),
    getSettings(),
    getProviderNodes(),
  ]);

  const conns = connections.status === "fulfilled" ? connections.value : [];
  const comboList = combos.status === "fulfilled" ? combos.value : [];
  const keys = apiKeys.status === "fulfilled" ? apiKeys.value : [];
  const cfg: Settings = settings.status === "fulfilled" ? settings.value : ({} as Settings);
  const nodeMap = new Map<string, Record<string, unknown>>(
    (providerNodesResult.status === "fulfilled" ? providerNodesResult.value : []).map((n: any) => [
      n.id,
      n as Record<string, unknown>,
    ]),
  );

  const providers: Record<string, unknown> = {
    total: conns.length,
    enabled: conns.filter((c: any) => c.enabled !== false).length,
    combos: comboList.length,
    apiKeys: keys.length,
  };

  // — Provider breakdown by status —
  const now = Date.now();
  const byStatus: Record<string, number> = { active: 0, error: 0, untested: 0, rateLimited: 0, modelLocked: 0 };
  const byProvider: Record<string, { total: number; active: number; error: number; rateLimited: number }> = {};

  for (const c of conns) {
    const isRateLimited = c.rateLimitedUntil && new Date(String(c.rateLimitedUntil)).getTime() > now;
    const hasModelLocks = Object.keys(c).some(
      (k) => k.startsWith("modelLock_") && c[k] && new Date(String(c[k])).getTime() > now,
    );

    let status;
    if (isRateLimited) status = "rateLimited";
    else if (hasModelLocks) status = "modelLocked";
    else if (c.testStatus === "error" || c.testStatus === "unavailable") status = "error";
    else if (c.testStatus === "active") status = "active";
    else status = "untested";

    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const pKey = c.provider;
    if (!byProvider[pKey]) byProvider[pKey] = { total: 0, active: 0, error: 0, rateLimited: 0 };
    byProvider[pKey].total++;
    if (status === "active" || status === "untested") byProvider[pKey].active++;
    else if (status === "error") byProvider[pKey].error++;
    else if (status === "rateLimited") byProvider[pKey].rateLimited++;
  }

  providers.byStatus = byStatus;
  providers.byProvider = byProvider;

  const tunnel = {
    cloudflareEnabled: cfg.tunnelEnabled ?? false,
    cloudflareUrl: cfg.tunnelUrl ?? "",
    tailscaleEnabled: cfg.tailscaleEnabled ?? false,
    tailscaleUrl: cfg.tailscaleUrl ?? "",
  };

  const semanticCache = {
    enabled: cfg.semanticCacheEnabled ?? false,
    maxSize: cfg.semanticCacheMaxSize ?? 100,
    ttlMs: cfg.semanticCacheTTL ?? 1800000,
  };

  // — Cache occupancy —
  const caches: Record<string, unknown> = {};
  try {
    const semStats = getCacheStats();
    const semMemoryStats =
      semStats.memoryEntries !== undefined
        ? {
            currentSize: semStats.memoryEntries,
            maxSize:
              semStats.dbEntries !== undefined ? (cfg.semanticCacheMaxSize ?? 100) : (cfg.semanticCacheMaxSize ?? 100),
            currentBytes: null,
            maxBytes: parseInt(process.env.SEMANTIC_CACHE_MAX_BYTES || String(4 * 1024 * 1024), 10),
            hitRate: semStats.hitRate,
            hits: semStats.hits,
            misses: semStats.misses,
            tokensSaved: semStats.tokensSaved,
          }
        : null;
    caches.semanticCache = {
      enabled: cfg.semanticCacheEnabled ?? false,
      ...semStats,
      ...(semMemoryStats || {}),
      ttlMs: cfg.semanticCacheTTL ?? 1800000,
    };
  } catch {
    caches.semanticCache = { enabled: cfg.semanticCacheEnabled ?? false, error: "unavailable" };
  }

  try {
    const promptCache = getPromptCache();
    const pStats = promptCache.getStats();
    caches.promptCache = {
      enabled: true,
      currentSize: pStats.size,
      maxSize: pStats.maxSize,
      currentBytes: pStats.bytes,
      maxBytes: pStats.maxBytes,
      hitRate: `${pStats.hitRate.toFixed(1)}%`,
      hits: pStats.hits,
      misses: pStats.misses,
      evictions: pStats.evictions,
      ttlMs: parseInt(process.env.PROMPT_CACHE_TTL_MS || "300000", 10),
    };
  } catch {
    caches.promptCache = { enabled: true, error: "unavailable" };
  }

  try {
    const mStats = getMemoryStoreStats();
    caches.memoryStore = {
      size: mStats.size,
      maxSize: mStats.maxSize,
      bytes: mStats.bytes,
      maxBytes: mStats.maxBytes,
      hitRate: `${mStats.hitRate.toFixed(1)}%`,
      hits: mStats.hits,
      misses: mStats.misses,
    };
  } catch {
    caches.memoryStore = { error: "unavailable" };
  }

  try {
    const cStats = getConnectionNameCacheStats();
    caches.connectionNameCache = {
      size: cStats.size,
      maxSize: cStats.maxSize,
      bytes: cStats.bytes,
      maxBytes: cStats.maxBytes,
    };
  } catch {
    caches.connectionNameCache = { error: "unavailable" };
  }

  // — In-flight dedup —
  let inFlight;
  try {
    inFlight = getInFlightStats();
  } catch {
    inFlight = { count: 0 };
  }

  // — Pending requests —
  let pending;
  try {
    pending = getPendingStats();
  } catch {
    pending = { total: 0, byProvider: {} };
  }

  // — Background sync —
  let sync;
  try {
    const mDevStatus = getModelsDevSyncStatus();
    let cloudSync;
    try {
      const cStatus = getCloudSyncStatus();
      cloudSync = {
        enabled: cStatus.enabled,
        lastSyncAt: cStatus.lastSyncAt,
      };
    } catch {
      cloudSync = { enabled: false, lastSyncAt: null };
    }
    sync = {
      modelsDev: {
        enabled: true,
        intervalHours: (mDevStatus.intervalMs || 3600000) / 3600000,
        lastSyncAt: mDevStatus.lastSync,
        lastSyncOk: mDevStatus.lastSync != null,
        lastError: null,
      },
      cloud: cloudSync,
    };
  } catch {
    sync = {
      modelsDev: { enabled: true, intervalHours: 1, lastSyncAt: null, lastSyncOk: false, lastError: null },
      cloud: { enabled: false, lastSyncAt: null },
    };
  }

  // — Provider health (existing circuit-breaker section) —
  const providerHealthMap: Record<string, Record<string, unknown>> = {};
  for (const c of conns) {
    const isRateLimited = c.rateLimitedUntil && new Date(String(c.rateLimitedUntil)).getTime() > now;
    const retryAfterMs = isRateLimited ? new Date(String(c.rateLimitedUntil)).getTime() - now : 0;
    let state = "CLOSED";
    if (isRateLimited) state = "OPEN";
    else if (c.testStatus === "error") state = "HALF_OPEN";
    const providerInfo = AI_PROVIDERS[c.provider];
    const isCompatible =
      isOpenAICompatibleProvider(c.provider) ||
      isAnthropicCompatibleProvider(c.provider) ||
      isCustomEmbeddingProvider(c.provider);
    const node = isCompatible ? nodeMap.get(c.provider) : null;
    const key = c.provider;
    if (!providerHealthMap[key]) {
      providerHealthMap[key] = {
        provider: c.provider,
        providerName: node?.name || providerInfo?.name || c.provider,
        providerPrefix: node?.prefix || null,
        isCompatible,
        state: "CLOSED",
        retryAfterMs: 0,
        rateLimitedUntil: null,
        connectionCount: 0,
      };
    }
    const entry = providerHealthMap[key] as {
      connectionCount: number;
      state: string;
      retryAfterMs: number;
      rateLimitedUntil: string | null;
      [key: string]: unknown;
    };
    entry.connectionCount += 1;
    const stateRank: Record<string, number> = { OPEN: 2, HALF_OPEN: 1, CLOSED: 0 };
    if ((stateRank[state] ?? -1) > (stateRank[entry.state] ?? 0)) {
      entry.state = state;
      entry.retryAfterMs = retryAfterMs;
      entry.rateLimitedUntil = (c.rateLimitedUntil as string) || null;
    }
  }

  const rateLimitByProvider: Record<
    string,
    {
      provider: string;
      providerName: string;
      rateLimitedCount: number;
      connections: { connectionId: string; connectionName: string; rateLimitedUntil: string; retryAfterMs: number }[];
    }
  > = {};
  for (const c of conns) {
    const isRateLimited = c.rateLimitedUntil && new Date(String(c.rateLimitedUntil)).getTime() > now;
    if (!isRateLimited) continue;
    const key = c.provider;
    if (!rateLimitByProvider[key]) {
      const providerInfo = AI_PROVIDERS[key];
      rateLimitByProvider[key] = {
        provider: key,
        providerName: providerInfo?.name || key,
        rateLimitedCount: 0,
        connections: [],
      };
    }
    rateLimitByProvider[key].rateLimitedCount += 1;
    rateLimitByProvider[key].connections.push({
      connectionId: c.id,
      connectionName: c.name || c.provider,
      rateLimitedUntil: c.rateLimitedUntil as string,
      retryAfterMs: new Date(String(c.rateLimitedUntil)).getTime() - now,
    });
  }

  const MODEL_LOCK_PREFIX = "modelLock_";
  const CONN_LOCK_UNTIL_KEY = "connectionLockUntil";
  const CONN_LOCK_COUNT_KEY = "connectionLockCount";
  const CONN_LOCK_REASON_KEY = "connectionLockReason";

  // — Connection-level lockout status —
  const lockedAccounts: Record<string, unknown>[] = [];
  for (const c of conns) {
    const lockUntil = c[CONN_LOCK_UNTIL_KEY] as string | null;
    if (!lockUntil) continue;
    const expiry = new Date(lockUntil).getTime();
    if (expiry <= now) continue;
    const providerInfo = AI_PROVIDERS[c.provider];
    lockedAccounts.push({
      connectionId: c.id,
      connectionName: c.name || c.email || c.provider,
      provider: c.provider,
      providerName: providerInfo?.name || c.provider,
      lockedUntil: lockUntil,
      retryAfterMs: expiry - now,
      lockCount: c[CONN_LOCK_COUNT_KEY] || 1,
      lockReason: c[CONN_LOCK_REASON_KEY] || c.lastError || null,
    });
  }

  const blockedByModel: Record<
    string,
    { model: string; blockedCount: number; connections: Record<string, unknown>[]; earliestUnblockAt: string | null }
  > = {};
  for (const c of conns) {
    const providerInfo = AI_PROVIDERS[c.provider];
    for (const [key, val] of Object.entries(c)) {
      if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
      const expiry = new Date(String(val)).getTime();
      if (expiry <= now) continue;
      const modelName = key.slice(MODEL_LOCK_PREFIX.length);
      if (!blockedByModel[modelName]) {
        blockedByModel[modelName] = { model: modelName, blockedCount: 0, connections: [], earliestUnblockAt: null };
      }
      blockedByModel[modelName].blockedCount += 1;
      blockedByModel[modelName].connections.push({
        connectionId: c.id,
        connectionName: c.name || c.provider,
        provider: c.provider,
        providerName: providerInfo?.name || c.provider,
        blockedUntil: val,
        retryAfterMs: expiry - now,
      });
      if (
        !blockedByModel[modelName].earliestUnblockAt ||
        expiry < new Date(blockedByModel[modelName].earliestUnblockAt).getTime()
      ) {
        blockedByModel[modelName].earliestUnblockAt = String(val);
      }
    }
  }

  const isDatabaseOk = database.ok;
  const dbIntegrity = (database as Record<string, unknown>).integrity ?? "";
  const status = isDatabaseOk === true && dbIntegrity === "ok" ? "healthy" : "issues";
  const queueDepths = getQueueDepths();

  // — Data dir size —
  const dataDirSizeBytes = getDataDirSizeBytes();

  return {
    status,
    timestamp: Date.now(),
    version: {
      pod: APP_CONFIG.displayVersion,
      bun: process.versions.bun ?? null,
      node: process.version,
    },
    system,
    runtime: {
      memoryUsageHumanized: system.memoryUsageHumanized,
      memoryPressure: system.memoryPressure,
      memoryPressurePercent: system.memoryPressurePercent,
      rssPressure: system.rssPressure,
      rssPressurePercent: system.rssPressurePercent,
      dataDir: getDataDirPath(),
      dataDirSizeBytes,
      dataDirSizeHumanized: dataDirSizeBytes ? humanizeBytes(dataDirSizeBytes) : null,
      processStartedAt: system.processStartedAt,
    },
    database,
    providers,
    tunnel,
    semanticCache,
    caches,
    inFlight,
    pending,
    sync,
    queueDepths,
    providerHealth: Object.values(providerHealthMap),
    rateLimitStatus: Object.values(rateLimitByProvider),
    blockedModelStatus: Object.values(blockedByModel),
    connectionLockStatus: lockedAccounts,
  };
}
