import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getApiKeys, getCombos, getProviderConnections, getProviderNodes, getSettings } from "@/lib/localDb.js";
import { getDatabase } from "@/lib/sqlite/connection.js";
import { getQueueDepths, getPendingStats, getConnectionNameCacheStats } from "@/lib/usageDb.js";
import { getCacheStats } from "@/lib/semanticCache.js";
import { getInFlightStats } from "@/lib/semanticCache.js";
import { getPromptCache } from "@/lib/cacheLayer.js";
import { getMemoryStoreStats } from "@/lib/memory/store.js";
import { getSyncStatus as getModelsDevSyncStatus } from "@/lib/modelsDevSync.js";
import { getCloudSyncStatus } from "@/shared/services/cloudSyncScheduler.js";
import { displayVersion } from "@/shared/constants/config.js";
import {
  AI_PROVIDERS,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers.js";

// biome-ignore lint/suspicious/noAssignInExpressions: globalThis singleton pattern for HMR survival
const START_TIME = globalThis.__pod_start_time ?? (globalThis.__pod_start_time = Date.now());

// Cache integrity_check result — it's an O(n-pages) full scan, too expensive
// to run on every SSE poll. Re-run at most once every 5 minutes.
const INTEGRITY_CACHE_TTL_MS = 5 * 60 * 1000;
let _integrityCache = null;
let _integrityCacheAt = 0;

function getCachedIntegrity(db) {
  const now = Date.now();
  if (_integrityCache && now - _integrityCacheAt < INTEGRITY_CACHE_TTL_MS) {
    return _integrityCache;
  }
  const result = db.prepare("PRAGMA integrity_check").get();
  _integrityCache = result?.integrity_check ?? "ok";
  _integrityCacheAt = now;
  return _integrityCache;
}

function humanizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getSystemInfo() {
  const mem = process.memoryUsage();
  const memoryPressure = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;
  return {
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    nodeVersion: process.version,
    bunVersion: process.versions.bun ?? null,
    platform: process.platform,
    arch: process.arch,
    memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    memoryUsageHumanized: {
      rss: humanizeBytes(mem.rss),
      heapUsed: humanizeBytes(mem.heapUsed),
      heapTotal: humanizeBytes(mem.heapTotal),
    },
    memoryPressure: Math.round(memoryPressure * 10000) / 10000,
    memoryPressurePercent: `${(memoryPressure * 100).toFixed(1)}%`,
    freeMemory: os.freemem(),
    totalMemory: os.totalmem(),
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
    return { ok: false, error: err.message };
  }
}

function getDataDirSizeBytes() {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/root";
    const dataDir = path.join(homeDir, ".pod");
    // Best-effort — stat the sqlite file (data dir itself may be large)
    const dbPath = path.join(dataDir, "pod.sqlite");
    const stat = fs.statSync(dbPath);
    return stat.size;
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
  const cfg = settings.status === "fulfilled" ? settings.value : {};
  const nodeMap = new Map(
    (providerNodesResult.status === "fulfilled" ? providerNodesResult.value : []).map((n) => [n.id, n]),
  );

  const providers = {
    total: conns.length,
    enabled: conns.filter((c) => c.enabled !== false).length,
    combos: comboList.length,
    apiKeys: keys.length,
  };

  // — Provider breakdown by status —
  const now = Date.now();
  const byStatus = { active: 0, error: 0, untested: 0, rateLimited: 0, modelLocked: 0 };
  const byProvider = {};

  for (const c of conns) {
    const isRateLimited = c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > now;
    const hasModelLocks = Object.keys(c).some(
      (k) => k.startsWith("modelLock_") && c[k] && new Date(c[k]).getTime() > now,
    );

    let status;
    if (isRateLimited) status = "rateLimited";
    else if (hasModelLocks) status = "modelLocked";
    else if (c.testStatus === "error" || c.testStatus === "unavailable") status = "error";
    else if (c.testStatus === "active") status = "active";
    else status = "untested";

    byStatus[status] = (byStatus[status] || 0) + 1;

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
  const caches = {};
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
  const providerHealthMap = {};
  for (const c of conns) {
    const isRateLimited = c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > now;
    const retryAfterMs = isRateLimited ? new Date(c.rateLimitedUntil).getTime() - now : 0;
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
    const entry = providerHealthMap[key];
    entry.connectionCount += 1;
    const stateRank = { OPEN: 2, HALF_OPEN: 1, CLOSED: 0 };
    if (stateRank[state] > stateRank[entry.state]) {
      entry.state = state;
      entry.retryAfterMs = retryAfterMs;
      entry.rateLimitedUntil = c.rateLimitedUntil || null;
    }
  }

  const rateLimitByProvider = {};
  for (const c of conns) {
    const isRateLimited = c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > now;
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
      rateLimitedUntil: c.rateLimitedUntil,
      retryAfterMs: new Date(c.rateLimitedUntil).getTime() - now,
    });
  }

  const MODEL_LOCK_PREFIX = "modelLock_";
  const blockedByModel = {};
  for (const c of conns) {
    const providerInfo = AI_PROVIDERS[c.provider];
    for (const [key, val] of Object.entries(c)) {
      if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
      const expiry = new Date(val).getTime();
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
        blockedByModel[modelName].earliestUnblockAt = val;
      }
    }
  }

  const status = database.ok && database.integrity === "ok" ? "healthy" : "issues";
  const queueDepths = getQueueDepths();

  // — Data dir size —
  const dataDirSizeBytes = getDataDirSizeBytes();

  return {
    status,
    timestamp: Date.now(),
    version: {
      pod: displayVersion,
      bun: process.versions.bun ?? null,
      node: process.version,
    },
    system,
    runtime: {
      memoryUsageHumanized: system.memoryUsageHumanized,
      memoryPressure: system.memoryPressure,
      memoryPressurePercent: system.memoryPressurePercent,
      dataDirSizeBytes,
      processStartedAt: system.processStartedAt,
      dataDir: dataDirSizeBytes ? humanizeBytes(dataDirSizeBytes) : null,
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
  };
}
