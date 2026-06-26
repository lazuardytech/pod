// models.dev pricing sync — fetches https://models.dev/api.json and stores
// pricing data in the local SQLite DB. Runs on a configurable interval and
// survives Next.js HMR via globalThis singleton.

import { info, warn, error as logError } from "@/sse/utils/logger.js";
import { getDatabase } from "@/lib/sqlite/connection";

// ─── HMR-safe singleton ───────────────────────────────────────────────────────

type ModelsDevSyncState = {
  timer: ReturnType<typeof setInterval> | null;
  lastSync: string | null;
  lastSyncModelCount: number;
  intervalMs: number;
  syncPromise: Promise<unknown> | null;
};

// biome-ignore lint/suspicious/noAssignInExpressions: globalThis singleton pattern for HMR survival
const g: ModelsDevSyncState = (globalThis.__modelsDevSync ??= {
  timer: null,
  lastSync: null,
  lastSyncModelCount: 0,
  intervalMs: 3600000,
  syncPromise: null,
});

// In-memory pricing cache: { [provider]: { [model]: { input, output, ... } } }
let _pricingCache: Record<string, Record<string, ModelPricingEntry>> | null = null;

// In-memory raw API cache with TTL
let _apiCache: unknown = null;
let _apiCacheAt = 0;
const API_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const MODELS_DEV_URL = "https://models.dev/api.json";

// ─── Provider ID mapping ──────────────────────────────────────────────────────
// Maps models.dev provider IDs → Pod provider IDs
const MODELS_DEV_PROVIDER_MAP: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  "google-vertex": "vertex",
  deepseek: "deepseek",
  groq: "groq",
  xai: "xai",
  mistral: "mistral",
  together: "together",
  togetherai: "together",
  fireworks: "fireworks",
  "fireworks-ai": "fireworks",
  cerebras: "cerebras",
  cohere: "cohere",
  ollama: "ollama",
  blackbox: "blackbox",
  minimax: "minimax",
  "amazon-bedrock": "bedrock",
  bedrock: "bedrock",
  azure: "azure",
  "azure-openai": "azure",
  cloudflare: "cloudflare",
  replicate: "replicate",
  huggingface: "huggingface",
  "hugging-face": "huggingface",
  novita: "novita",
  openrouter: "openrouter",
  "open-router": "openrouter",
  sambanova: "sambanova",
  "samba-nova": "sambanova",
  nvidia: "nvidia",
  "nvidia-nim": "nvidia",
  ai21: "ai21",
  "ai21-labs": "ai21",
  voyage: "voyage",
  jina: "jina",
  moonshot: "moonshot",
  qwen: "qwen",
  alibaba: "qwen",
  baidu: "baidu",
  zhipu: "zhipu",
  "01-ai": "yi",
  yi: "yi",
  inflection: "inflection",
  writer: "writer",
  upstage: "upstage",
  "lepton-ai": "lepton",
  lepton: "lepton",
  octoai: "octoai",
  "octo-ai": "octoai",
  lambda: "lambda",
  "lambda-labs": "lambda",
  hyperbolic: "hyperbolic",
  deepinfra: "deepinfra",
  "deep-infra": "deepinfra",
};

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch models.dev API JSON with 24h in-memory cache.
 */
export async function fetchModelsDev(signal?: AbortSignal): Promise<unknown> {
  const now = Date.now();
  if (_apiCache && now - _apiCacheAt < API_CACHE_TTL_MS) {
    return _apiCache;
  }

  const res = await fetch(MODELS_DEV_URL, {
    signal,
    headers: { "User-Agent": "pod-pricing-sync/1.0" },
  });

  if (!res.ok) {
    throw new Error(`models.dev fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  _apiCache = data;
  _apiCacheAt = now;
  return data;
}

// ─── Transform ───────────────────────────────────────────────────────────────

export type ModelPricingEntry = {
  input?: number;
  output?: number;
  cached?: number;
  cache_creation?: number;
  reasoning?: number;
};

export type ModelsDevPricingData = Record<string, Record<string, ModelPricingEntry>>;

/**
 * Transform raw models.dev API response to Pod pricing shape.
 * Returns { [podProvider]: { [modelId]: { input, output, cached?, cache_creation?, reasoning? } } }
 * All rates are in $/1M tokens (models.dev uses $/1M natively).
 */
export function transformModelsDevToPricing(raw: unknown): ModelsDevPricingData {
  const result: ModelsDevPricingData = {};

  // models.dev api.json shape: { [providerId]: { models: { [modelId]: { pricing?: { input, output, ... } } } } }
  // or flat array — handle both shapes defensively
  const entries: unknown[] = Array.isArray(raw) ? raw : Object.entries(raw as Record<string, unknown>);

  for (const entry of entries) {
    let providerId: string | undefined;
    let providerData: Record<string, unknown> | undefined;
    if (Array.isArray(entry)) {
      const [id, data] = entry as [string, Record<string, unknown>];
      providerId = id;
      providerData = data;
    } else if (entry && typeof entry === "object") {
      const obj = entry as { id?: unknown; provider?: unknown };
      providerId = (typeof obj.id === "string" ? obj.id : typeof obj.provider === "string" ? obj.provider : undefined);
      providerData = entry as Record<string, unknown>;
    } else {
      continue;
    }

    if (!providerId || typeof providerData !== "object") continue;

    const podProvider = MODELS_DEV_PROVIDER_MAP[String(providerId).toLowerCase()] ?? String(providerId).toLowerCase();

    // models can be under .models (object or array)
    const modelsRaw = providerData.models;
    if (!modelsRaw) continue;

    const modelEntries: Array<[string, unknown]> = Array.isArray(modelsRaw)
      ? (modelsRaw as Array<{ id?: string; name?: string }>).map((m) => [m.id ?? m.name ?? "", m])
      : Object.entries(modelsRaw as Record<string, unknown>);

    for (const [modelId, modelDataRaw] of modelEntries) {
      if (!modelId || !modelDataRaw || typeof modelDataRaw !== "object") continue;

      const modelData = modelDataRaw as { cost?: Record<string, unknown> };
      // pricing is under .cost in models.dev api.json
      const cost = modelData.cost;
      if (!cost || typeof cost !== "object") continue;

      const input = toMillionTokenRate(cost.input);
      const output = toMillionTokenRate(cost.output);

      // Skip models with no usable pricing
      if (input == null && output == null) continue;

      const entryOut: ModelPricingEntry = {};
      if (input != null) entryOut.input = input;
      if (output != null) entryOut.output = output;

      const cached = toMillionTokenRate(cost.cache_read);
      if (cached != null) entryOut.cached = cached;

      const cacheCreation = toMillionTokenRate(cost.cache_write);
      if (cacheCreation != null) entryOut.cache_creation = cacheCreation;

      const reasoning = toMillionTokenRate(cost.reasoning);
      if (reasoning != null) entryOut.reasoning = reasoning;

      if (!result[podProvider]) result[podProvider] = {};
      result[podProvider][String(modelId)] = entryOut;
    }
  }

  return result;
}

/**
 * Normalize a pricing value to $/1M tokens.
 * models.dev already uses $/1M, but guard against null/undefined/string.
 */
function toMillionTokenRate(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

/**
 * Save transformed pricing data to models_dev_pricing table.
 * Uses INSERT OR REPLACE so re-runs are idempotent.
 */
export function saveModelsDevPricing(data: ModelsDevPricingData): void {
  const db = getDatabase();
  const stmt = db.prepare("INSERT OR REPLACE INTO models_dev_pricing (provider, model, data) VALUES (?, ?, ?)");
  const run = db.transaction((pricing: ModelsDevPricingData) => {
    for (const [provider, models] of Object.entries(pricing)) {
      for (const [model, p] of Object.entries(models)) {
        stmt.run(provider, model, JSON.stringify(p));
      }
    }
  });
  run(data);

  // Invalidate in-memory cache so next lookup re-reads from DB
  _pricingCache = null;
}

// ─── Cache / lookup ───────────────────────────────────────────────────────────

/**
 * Load all models_dev_pricing rows into the in-memory cache.
 */
export function loadModelsDevPricingCache(): Record<string, Record<string, ModelPricingEntry>> {
  const db = getDatabase();
  const rows = db.prepare("SELECT provider, model, data FROM models_dev_pricing").all() as Array<{
    provider: string;
    model: string;
    data: string;
  }>;
  _pricingCache = {};
  for (const r of rows) {
    if (!_pricingCache[r.provider]) _pricingCache[r.provider] = {};
    try {
      _pricingCache[r.provider][r.model] = JSON.parse(r.data) as ModelPricingEntry;
    } catch {
      // skip malformed rows
    }
  }
  return _pricingCache;
}

/**
 * Look up pricing for a specific provider+model from the in-memory cache.
 * Loads from DB on first call.
 */
export function getModelsDevPricingForModel(provider: string, model: string): ModelPricingEntry | null {
  if (!_pricingCache) loadModelsDevPricingCache();
  if (!provider || !model) return null;
  return _pricingCache?.[provider]?.[model] ?? null;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export type SyncResult = {
  success: boolean;
  modelCount: number;
  providerCount: number;
  error?: string;
};

/**
 * Fetch, transform, and save models.dev pricing.
 * Deduplicates concurrent calls via g.syncPromise.
 */
export async function syncModelsDev(opts: { signal?: AbortSignal } = {}): Promise<SyncResult> {
  // Deduplicate concurrent syncs
  if (g.syncPromise) return g.syncPromise as Promise<SyncResult>;

  g.syncPromise = _doSync(opts).finally(() => {
    g.syncPromise = null;
  });
  return g.syncPromise as Promise<SyncResult>;
}

async function _doSync(opts: { signal?: AbortSignal } = {}): Promise<SyncResult> {
  try {
    info("modelsDevSync", "Starting sync...");
    const raw = await fetchModelsDev(opts.signal);
    const pricing = transformModelsDevToPricing(raw);

    const providerCount = Object.keys(pricing).length;
    let modelCount = 0;
    for (const models of Object.values(pricing)) {
      modelCount += Object.keys(models).length;
    }

    saveModelsDevPricing(pricing);

    // Persist sync metadata
    try {
      const db = getDatabase();
      const metaStmt = db.prepare("INSERT OR REPLACE INTO models_dev_sync_meta (key, value) VALUES (?, ?)");
      const now = new Date().toISOString();
      db.transaction(() => {
        metaStmt.run("lastSync", now);
        metaStmt.run("lastSyncModelCount", String(modelCount));
      })();
    } catch (metaErr) {
      warn("modelsDevSync", "Failed to write sync meta", { error: (metaErr as Error).message });
    }

    g.lastSync = new Date().toISOString();
    g.lastSyncModelCount = modelCount;

    info("modelsDevSync", `Sync complete: ${modelCount} models across ${providerCount} providers`);
    return { success: true, modelCount, providerCount };
  } catch (err) {
    logError("modelsDevSync", "Sync failed", { error: (err as Error).message });
    return { success: false, modelCount: 0, providerCount: 0, error: (err as Error).message };
  }
}

// ─── Periodic sync ────────────────────────────────────────────────────────────

/**
 * Start periodic sync. Runs an initial sync immediately.
 * Safe to call multiple times — only one timer runs at a time.
 */
export function startPeriodicSync(intervalMs: number = 3600000): void {
  if (g.timer) return; // already running

  g.intervalMs = intervalMs;

  // Run immediately (non-blocking)
  syncModelsDev().catch((err) => logError("modelsDevSync", "Initial sync error", { error: (err as Error).message }));

  g.timer = setInterval(() => {
    syncModelsDev().catch((err) => logError("modelsDevSync", "Periodic sync error", { error: (err as Error).message }));
  }, intervalMs);

  if (g.timer.unref) g.timer.unref();
  info("modelsDevSync", `Periodic sync started (interval: ${intervalMs}ms)`);
}

/**
 * Stop periodic sync.
 */
export function stopPeriodicSync(): void {
  if (g.timer) {
    clearInterval(g.timer);
    g.timer = null;
    info("modelsDevSync", "Periodic sync stopped");
  }
}

export type SyncStatus = {
  lastSync: string | null;
  lastSyncModelCount: number;
  nextSync: string | null;
  intervalMs: number;
};

/**
 * Return current sync status.
 */
export function getSyncStatus(): SyncStatus {
  const nextSync = g.lastSync && g.timer ? new Date(new Date(g.lastSync).getTime() + g.intervalMs).toISOString() : null;
  return {
    lastSync: g.lastSync,
    lastSyncModelCount: g.lastSyncModelCount,
    nextSync,
    intervalMs: g.intervalMs,
  };
}
