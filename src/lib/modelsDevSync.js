// models.dev pricing sync — fetches https://models.dev/api.json and stores
// pricing data in the local SQLite DB. Runs on a configurable interval and
// survives Next.js HMR via globalThis singleton.

import { getDatabase } from "@/lib/sqlite/connection.js";

// ─── HMR-safe singleton ───────────────────────────────────────────────────────
// biome-ignore lint/suspicious/noAssignInExpressions: globalThis singleton pattern for HMR survival
const g = (globalThis.__modelsDevSync ??= {
  timer: null,
  lastSync: null,
  lastSyncModelCount: 0,
  intervalMs: 3600000,
  syncPromise: null,
});

// In-memory pricing cache: { [provider]: { [model]: { input, output, ... } } }
let _pricingCache = null;

// In-memory raw API cache with TTL
let _apiCache = null;
let _apiCacheAt = 0;
const API_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const MODELS_DEV_URL = "https://models.dev/api.json";

// ─── Provider ID mapping ──────────────────────────────────────────────────────
// Maps models.dev provider IDs → Pod provider IDs
const MODELS_DEV_PROVIDER_MAP = {
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
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}
 */
export async function fetchModelsDev(signal) {
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

/**
 * Transform raw models.dev API response to Pod pricing shape.
 * Returns { [podProvider]: { [modelId]: { input, output, cached?, cache_creation?, reasoning? } } }
 * All rates are in $/1M tokens (models.dev uses $/1M natively).
 *
 * @param {object} raw
 * @returns {object}
 */
export function transformModelsDevToPricing(raw) {
  const result = {};

  // models.dev api.json shape: { [providerId]: { models: { [modelId]: { pricing?: { input, output, ... } } } } }
  // or flat array — handle both shapes defensively
  const entries = Array.isArray(raw) ? raw : Object.entries(raw);

  for (const entry of entries) {
    let providerId, providerData;
    if (Array.isArray(entry)) {
      [providerId, providerData] = entry;
    } else if (entry && typeof entry === "object") {
      providerId = entry.id || entry.provider;
      providerData = entry;
    } else {
      continue;
    }

    if (!providerId || typeof providerData !== "object") continue;

    const podProvider = MODELS_DEV_PROVIDER_MAP[String(providerId).toLowerCase()] ?? String(providerId).toLowerCase();

    // models can be under .models (object or array)
    const modelsRaw = providerData.models;
    if (!modelsRaw) continue;

    const modelEntries = Array.isArray(modelsRaw)
      ? modelsRaw.map((m) => [m.id ?? m.name, m])
      : Object.entries(modelsRaw);

    for (const [modelId, modelData] of modelEntries) {
      if (!modelId || !modelData || typeof modelData !== "object") continue;

      // pricing is under .cost in models.dev api.json
      const cost = modelData.cost;
      if (!cost || typeof cost !== "object") continue;

      const input = toMillionTokenRate(cost.input);
      const output = toMillionTokenRate(cost.output);

      // Skip models with no usable pricing
      if (input == null && output == null) continue;

      const entry = {};
      if (input != null) entry.input = input;
      if (output != null) entry.output = output;

      const cached = toMillionTokenRate(cost.cache_read);
      if (cached != null) entry.cached = cached;

      const cacheCreation = toMillionTokenRate(cost.cache_write);
      if (cacheCreation != null) entry.cache_creation = cacheCreation;

      const reasoning = toMillionTokenRate(cost.reasoning);
      if (reasoning != null) entry.reasoning = reasoning;

      if (!result[podProvider]) result[podProvider] = {};
      result[podProvider][String(modelId)] = entry;
    }
  }

  return result;
}

/**
 * Normalize a pricing value to $/1M tokens.
 * models.dev already uses $/1M, but guard against null/undefined/string.
 * @param {*} val
 * @returns {number|null}
 */
function toMillionTokenRate(val) {
  if (val == null) return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

/**
 * Save transformed pricing data to models_dev_pricing table.
 * Uses INSERT OR REPLACE so re-runs are idempotent.
 * @param {object} data — { [provider]: { [model]: pricingObj } }
 */
export function saveModelsDevPricing(data) {
  const db = getDatabase();
  const stmt = db.prepare("INSERT OR REPLACE INTO models_dev_pricing (provider, model, data) VALUES (?, ?, ?)");
  const run = db.transaction((pricing) => {
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
export function loadModelsDevPricingCache() {
  const db = getDatabase();
  const rows = db.prepare("SELECT provider, model, data FROM models_dev_pricing").all();
  _pricingCache = {};
  for (const r of rows) {
    if (!_pricingCache[r.provider]) _pricingCache[r.provider] = {};
    try {
      _pricingCache[r.provider][r.model] = JSON.parse(r.data);
    } catch {
      // skip malformed rows
    }
  }
  return _pricingCache;
}

/**
 * Look up pricing for a specific provider+model from the in-memory cache.
 * Loads from DB on first call.
 * @param {string} provider
 * @param {string} model
 * @returns {object|null}
 */
export function getModelsDevPricingForModel(provider, model) {
  if (!_pricingCache) loadModelsDevPricingCache();
  if (!provider || !model) return null;
  return _pricingCache[provider]?.[model] ?? null;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Fetch, transform, and save models.dev pricing.
 * Deduplicates concurrent calls via g.syncPromise.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ success: boolean, modelCount: number, providerCount: number, error?: string }>}
 */
export async function syncModelsDev(opts = {}) {
  // Deduplicate concurrent syncs
  if (g.syncPromise) return g.syncPromise;

  g.syncPromise = _doSync(opts).finally(() => {
    g.syncPromise = null;
  });
  return g.syncPromise;
}

async function _doSync(opts = {}) {
  try {
    console.log("[modelsDevSync] Starting sync...");
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
      console.warn("[modelsDevSync] Failed to write sync meta:", metaErr.message);
    }

    g.lastSync = new Date().toISOString();
    g.lastSyncModelCount = modelCount;

    console.log(`[modelsDevSync] Sync complete: ${modelCount} models across ${providerCount} providers`);
    return { success: true, modelCount, providerCount };
  } catch (err) {
    console.error("[modelsDevSync] Sync failed:", err.message);
    return { success: false, modelCount: 0, providerCount: 0, error: err.message };
  }
}

// ─── Periodic sync ────────────────────────────────────────────────────────────

/**
 * Start periodic sync. Runs an initial sync immediately.
 * Safe to call multiple times — only one timer runs at a time.
 * @param {number} intervalMs
 */
export function startPeriodicSync(intervalMs = 3600000) {
  if (g.timer) return; // already running

  g.intervalMs = intervalMs;

  // Run immediately (non-blocking)
  syncModelsDev().catch((err) => console.error("[modelsDevSync] Initial sync error:", err.message));

  g.timer = setInterval(() => {
    syncModelsDev().catch((err) => console.error("[modelsDevSync] Periodic sync error:", err.message));
  }, intervalMs);

  if (g.timer.unref) g.timer.unref();
  console.log(`[modelsDevSync] Periodic sync started (interval: ${intervalMs}ms)`);
}

/**
 * Stop periodic sync.
 */
export function stopPeriodicSync() {
  if (g.timer) {
    clearInterval(g.timer);
    g.timer = null;
    console.log("[modelsDevSync] Periodic sync stopped");
  }
}

/**
 * Return current sync status.
 * @returns {{ lastSync: string|null, lastSyncModelCount: number, nextSync: string|null, intervalMs: number }}
 */
export function getSyncStatus() {
  const nextSync = g.lastSync && g.timer ? new Date(new Date(g.lastSync).getTime() + g.intervalMs).toISOString() : null;
  return {
    lastSync: g.lastSync,
    lastSyncModelCount: g.lastSyncModelCount,
    nextSync,
    intervalMs: g.intervalMs,
  };
}
