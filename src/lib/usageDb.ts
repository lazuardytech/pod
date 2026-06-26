// Usage analytics facade. SQLite-backed on Node; no-op on Workers.
// In-memory pending-request tracker + statsEmitter are preserved exactly
// (same global state, same observable semantics) because consumers subscribe
// to `statsEmitter` events from SSE routes.

import { EventEmitter } from "node:events";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir";
import { error as logError, info as logInfo } from "@/sse/utils/logger.js";
import { LRUCache } from "@/lib/cacheLayer";
import { closeDatabase, getDatabase } from "@/lib/sqlite/connection";

const isCloud = typeof caches !== "undefined" || typeof caches === "object";

if (!isCloud && fs?.existsSync && !fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

// ===== Global in-memory state (unchanged semantics) ======================

if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
const pendingRequests = global._pendingRequests as {
  byModel: Record<string, number>;
  byAccount: Record<string, Record<string, number>>;
};

if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
const lastErrorProvider = global._lastErrorProvider as { provider: string; ts: number };

if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
export const statsEmitter: EventEmitter = global._statsEmitter;

if (!global._pendingTimers) global._pendingTimers = {};
const pendingTimers = global._pendingTimers as Record<string, ReturnType<typeof setTimeout>[]>;

const PENDING_TIMEOUT_MS = 60 * 1000;

// ===== Helpers ===========================================================

function getLocalDateKey(timestamp?: string | number | Date): string {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tokensFromEntry(entry: UsageEntry): { prompt: number; completion: number } {
  const t = entry.tokens || {};
  return {
    prompt: t.prompt_tokens ?? t.input_tokens ?? 0,
    completion: t.completion_tokens ?? t.output_tokens ?? 0,
  };
}

function upsertSummary(
  db: ReturnType<typeof getDatabase>,
  dateKey: string,
  bucket: string,
  key: string,
  delta: { requests?: number; promptTokens?: number; completionTokens?: number; cost?: number },
  meta: unknown = null,
): void {
  db.prepare(`
    INSERT INTO daily_summary
      (date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date_key, bucket, key) DO UPDATE SET
      requests          = requests + excluded.requests,
      prompt_tokens     = prompt_tokens + excluded.prompt_tokens,
      completion_tokens = completion_tokens + excluded.completion_tokens,
      cost              = cost + excluded.cost,
      data              = COALESCE(excluded.data, data)
  `).run(
    dateKey,
    bucket,
    key,
    delta.requests || 0,
    delta.promptTokens || 0,
    delta.completionTokens || 0,
    delta.cost || 0,
    meta ? JSON.stringify(meta) : null,
  );
}

function bumpTotalRequests(db: ReturnType<typeof getDatabase>): void {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES ('totalRequestsLifetime', '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST((CAST(meta.value AS INTEGER) + 1) AS TEXT)
  `).run();
}

export function trackPendingRequest(
  model: string,
  provider: string,
  connectionId: string,
  started: boolean,
  error: boolean = false,
): void {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(
      0,
      pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1),
    );
  }

  if (started) {
    if (!pendingTimers[timerKey]) pendingTimers[timerKey] = [];
    // One timer per started request — decrement only this request, not all.
    const handle = setTimeout(() => {
      const arr = pendingTimers[timerKey] || [];
      const idx = arr.indexOf(handle);
      if (idx >= 0) arr.splice(idx, 1);
      if (arr.length === 0) delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey]--;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey]--;
      }
      statsEmitter.emit("pending");
    }, PENDING_TIMEOUT_MS) as ReturnType<typeof setTimeout>;
    if (handle.unref) handle.unref();
    pendingTimers[timerKey].push(handle);
  } else {
    // Pop one outstanding timer for this key (paired with its start).
    const arr = pendingTimers[timerKey];
    if (arr && arr.length > 0) {
      clearTimeout(arr.pop() as ReturnType<typeof setTimeout>);
      if (arr.length === 0) delete pendingTimers[timerKey];
    }
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  if (process.env.PENDING_LOG === "true") {
    logInfo("PENDING", `${started ? "START" : "END"}${error ? " (ERROR)" : ""}`, { provider, model });
  }
  statsEmitter.emit("pending");
}

// ===== Write path ========================================================

type UsageEntry = {
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKey?: string;
  endpoint?: string;
  status?: string;
  tokens?: {
    prompt_tokens?: number;
    input_tokens?: number;
    completion_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    cache_read_input_tokens?: number;
    reasoning_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  cost?: number;
};

// In-memory queue of pending daily_summary upserts. usage_history rows still
// inserted synchronously so dashboard real-time view stays accurate.
if (!global._summaryQueue) global._summaryQueue = [];
const summaryQueue =
  (global._summaryQueue as Array<{
    timestamp: string;
    provider?: string;
    model?: string;
    connectionId?: string;
    apiKey?: string;
    endpoint?: string;
    prompt: number;
    completion: number;
    cost: number;
  }>) || [];
let summaryFlushTimer: ReturnType<typeof setTimeout> | null = null;
const SUMMARY_BATCH_SIZE = 50;
const SUMMARY_FLUSH_INTERVAL_MS = 500;

function scheduleSummaryFlush(): void {
  if (summaryFlushTimer) return;
  summaryFlushTimer = setTimeout(flushSummaryQueue, SUMMARY_FLUSH_INTERVAL_MS) as ReturnType<typeof setTimeout>;
  if (summaryFlushTimer.unref) summaryFlushTimer.unref();
}

async function calculateCost(
  provider: string | undefined,
  model: string | undefined,
  tokens: UsageEntry["tokens"] | undefined,
): Promise<number> {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("@/lib/localDb");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    let cost = 0;
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    cost += nonCachedInput * (pricing.input / 1000000);
    if (cachedTokens > 0) {
      const rate = pricing.cached || pricing.input;
      cost += cachedTokens * (rate / 1000000);
    }
    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += outputTokens * (pricing.output / 1000000);
    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
      const rate = pricing.reasoning || pricing.output;
      cost += reasoningTokens * (rate / 1000000);
    }
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) {
      const rate = pricing.cache_creation || pricing.input;
      cost += cacheCreationTokens * (rate / 1000000);
    }
    return cost;
  } catch {
    return 0;
  }
}

function readTotalRequests(db: ReturnType<typeof getDatabase>): number {
  const r = db.prepare("SELECT value FROM meta WHERE key = 'totalRequestsLifetime'").get() as
    | { value?: string }
    | undefined;
  return r ? parseInt(r.value, 10) || 0 : 0;
}

function flushSummaryQueue(): void {
  if (summaryFlushTimer) {
    clearTimeout(summaryFlushTimer);
    summaryFlushTimer = null;
  }
  if (summaryQueue.length === 0) return;
  const batch = summaryQueue.splice(0, summaryQueue.length);
  try {
    const db = getDatabase();
    const run = db.transaction(() => {
      for (const entry of batch) {
        const dateKey = getLocalDateKey(entry.timestamp);
        const vals = {
          requests: 1,
          promptTokens: entry.prompt,
          completionTokens: entry.completion,
          cost: entry.cost,
        };
        upsertSummary(db, dateKey, "day", "_", vals);
        if (entry.provider) upsertSummary(db, dateKey, "byProvider", entry.provider, vals);
        const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
        upsertSummary(db, dateKey, "byModel", modelKey, vals, { rawModel: entry.model, provider: entry.provider });
        if (entry.connectionId) {
          upsertSummary(db, dateKey, "byAccount", entry.connectionId, vals, {
            rawModel: entry.model,
            provider: entry.provider,
          });
        }
        const apiKeyVal = typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
        const akKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
        upsertSummary(db, dateKey, "byApiKey", akKey, vals, {
          rawModel: entry.model,
          provider: entry.provider,
          apiKey: entry.apiKey || null,
        });
        const endpoint = entry.endpoint || "Unknown";
        const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
        upsertSummary(db, dateKey, "byEndpoint", epKey, vals, {
          endpoint,
          rawModel: entry.model,
          provider: entry.provider,
        });
        bumpTotalRequests(db);
      }
    });
    run();
    statsEmitter.emit("update");
  } catch (err) {
    logError("usageDb", "Failed to flush daily_summary batch", { error: (err as Error)?.message || err });
  }
}

// Keep usage_history bounded — trim every ~100 inserts.
// Default: keep 90 days. Prevents unbounded table growth.
const USAGE_HISTORY_MAX_DAYS = 90;
let usageHistoryTrimCounter = 0;
const USAGE_HISTORY_TRIM_EVERY = 100;

function trimUsageHistoryIfNeeded(db: ReturnType<typeof getDatabase>): void {
  usageHistoryTrimCounter += 1;
  if (usageHistoryTrimCounter < USAGE_HISTORY_TRIM_EVERY) return;
  usageHistoryTrimCounter = 0;
  try {
    const cutoff = new Date(Date.now() - USAGE_HISTORY_MAX_DAYS * 86400000).toISOString();
    db.prepare("DELETE FROM usage_history WHERE timestamp < ?").run(cutoff);
  } catch {}
}

export async function saveRequestUsage(entry: UsageEntry): Promise<void> {
  if (isCloud) return;

  try {
    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const db = getDatabase();
    const { prompt, completion } = tokensFromEntry(entry);
    const cost = entry.cost || 0;

    // Insert usage_history row synchronously (dashboard real-time view).
    db.prepare(`
      INSERT INTO usage_history
      (timestamp, provider, model, connection_id, api_key, endpoint, status,
       prompt_tokens, completion_tokens, cost, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp,
      entry.provider || null,
      entry.model || null,
      entry.connectionId || null,
      typeof entry.apiKey === "string" ? entry.apiKey : null,
      entry.endpoint || null,
      entry.status || null,
      prompt,
      completion,
      cost,
      JSON.stringify({ tokens: entry.tokens || {} }),
    );

    // Defer the 6+ daily_summary upserts to a batched async flush.
    summaryQueue.push({
      timestamp: entry.timestamp,
      provider: entry.provider,
      model: entry.model,
      connectionId: entry.connectionId,
      apiKey: entry.apiKey,
      endpoint: entry.endpoint,
      prompt,
      completion,
      cost,
    });
    if (summaryQueue.length >= SUMMARY_BATCH_SIZE) flushSummaryQueue();
    else scheduleSummaryFlush();

    // Periodic trim to keep usage_history bounded
    trimUsageHistoryIfNeeded(db);
  } catch (err) {
    logError("usageDb", "Failed to save usage stats", { error: (err as Error)?.message || err });
  }
}

// ===== Logs (SQLite-backed, batched async writes) ========================

function formatLogDate(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Connection-name cache — per-entry LRU so individual entries expire
// independently and memory is bounded (replaces the old single-object
// all-or-nothing TTL cache).
const CONN_CACHE_TTL_MS = 30_000;
const connectionNameCache = new LRUCache<string>({ maxSize: 500, defaultTTL: CONN_CACHE_TTL_MS });

async function getConnectionName(connectionId: string | undefined): Promise<string> {
  if (!connectionId) return "-";
  const cached = connectionNameCache.get(connectionId);
  if (cached !== undefined) return cached;
  try {
    const { getProviderConnections } = await import("@/lib/localDb");
    const list = await getProviderConnections();
    for (const c of list) {
      connectionNameCache.set(c.id, c.name || c.email || c.id?.slice(0, 8));
    }
    return connectionNameCache.get(connectionId) || connectionId.slice(0, 8);
  } catch {
    return connectionId.slice(0, 8);
  }
}

type LogQueueItem = {
  timestamp: string;
  model: string;
  provider: string;
  account: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  status: string;
  combo: string | null;
  details_id: string | null;
};

// In-memory log queue, flushed on threshold or interval. Hot path is non-blocking.
const LOG_BATCH_SIZE = 50;
const LOG_FLUSH_INTERVAL_MS = 500;
const LOG_MAX_ROWS = 10000; // trim threshold

if (!global._logQueue) global._logQueue = [];
const logQueue: LogQueueItem[] = (global._logQueue as LogQueueItem[]) || [];
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
let logTrimCounter = 0;

function scheduleLogFlush(): void {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL_MS) as ReturnType<typeof setTimeout>;
  if (logFlushTimer.unref) logFlushTimer.unref();
}

function clearPendingRequestTimers(): void {
  for (const timerKey of Object.keys(pendingTimers)) {
    const handles = pendingTimers[timerKey] || [];
    for (const handle of handles) clearTimeout(handle);
    delete pendingTimers[timerKey];
  }
}

function flushLogs(): void {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  if (logQueue.length === 0) return;
  const batch = logQueue.splice(0, logQueue.length);
  try {
    const db = getDatabase();
    const insertStmt = db.prepare(
      `INSERT INTO request_log (timestamp, model, provider, account, prompt_tokens, completion_tokens, status, combo, details_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateStmt = db.prepare(
      `UPDATE request_log SET prompt_tokens = ?, completion_tokens = ?, status = ?, combo = COALESCE(?, combo), details_id = COALESCE(?, details_id)
       WHERE id = (
         SELECT id FROM request_log
         WHERE model = ? AND provider = ? AND status = 'PENDING'
         ORDER BY id DESC LIMIT 1
       )`,
    );
    const processMany = db.transaction((rows: LogQueueItem[]) => {
      for (const r of rows) {
        if (r.status !== "PENDING") {
          // Try to update existing PENDING row first
          const result = updateStmt.run(
            r.prompt_tokens,
            r.completion_tokens,
            r.status,
            r.combo ?? null,
            r.details_id ?? null,
            r.model,
            r.provider,
          );
          if (result.changes === 0) {
            // No PENDING row found, insert new
            insertStmt.run(
              r.timestamp,
              r.model,
              r.provider,
              r.account,
              r.prompt_tokens,
              r.completion_tokens,
              r.status,
              r.combo ?? null,
              r.details_id ?? null,
            );
          }
        } else {
          insertStmt.run(
            r.timestamp,
            r.model,
            r.provider,
            r.account,
            r.prompt_tokens,
            r.completion_tokens,
            r.status,
            r.combo ?? null,
            r.details_id ?? null,
          );
        }
      }
    });
    processMany(batch);

    // Periodic trim (keep latest LOG_MAX_ROWS) — runs every ~10 flushes
    logTrimCounter += 1;
    if (logTrimCounter >= 10) {
      logTrimCounter = 0;
      db.prepare(
        `DELETE FROM request_log WHERE id <= (
           SELECT id FROM request_log ORDER BY id DESC LIMIT 1 OFFSET ?
         )`,
      ).run(LOG_MAX_ROWS);
    }
  } catch (err) {
    logError("usageDb", "Failed to flush request_log", { error: (err as Error)?.message || err });
  }
}

// Final flush on process exit (safety net for buffered queues)
if (!isCloud && !global._flushHooksRegistered) {
  global._flushHooksRegistered = true;
  const flushAll = (): void => {
    clearPendingRequestTimers();
    flushSummaryQueue();
    flushLogs();
    try {
      closeDatabase();
    } catch {
      /* best effort during shutdown */
    }
  };
  process.on("beforeExit", flushAll);
  process.on("SIGINT", flushAll);
  process.on("SIGTERM", flushAll);
  process.on("exit", flushAll);
}

export type AppendRequestLogInput = {
  model?: string;
  provider?: string;
  connectionId?: string;
  tokens?: { prompt_tokens?: number; completion_tokens?: number } | null;
  status?: string;
  combo?: string | null;
  detailsId?: string | null;
};

export async function appendRequestLog({
  model,
  provider,
  connectionId,
  tokens,
  status,
  combo,
  detailsId,
}: AppendRequestLogInput): Promise<void> {
  if (isCloud) return;
  try {
    const account = await getConnectionName(connectionId);
    const promptTokens = tokens?.prompt_tokens ?? null;
    const completionTokens = tokens?.completion_tokens ?? null;
    logQueue.push({
      timestamp: formatLogDate(),
      model: model || "-",
      provider: provider ? provider.toUpperCase() : "-",
      account,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      status: String(status ?? ""),
      combo: combo || null,
      details_id: detailsId || null,
    });
    if (logQueue.length >= LOG_BATCH_SIZE) flushLogs();
    else scheduleLogFlush();
  } catch (err) {
    logError("usageDb", "Failed to enqueue request log", { error: (err as Error)?.message || err });
  }
}

export async function getRecentLogs(limit: number = 200): Promise<string[]> {
  if (isCloud) return [];
  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT timestamp, model, provider, account, prompt_tokens, completion_tokens, status, combo
       FROM request_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      timestamp: string;
      model: string;
      provider: string;
      account: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      status: string;
      combo: string | null;
    }>;
    return rows.map((r) => {
      const sent = r.prompt_tokens ?? "-";
      const received = r.completion_tokens ?? "-";
      return `${r.timestamp} | ${r.model || "-"} | ${r.provider || "-"} | ${r.account || "-"} | ${sent} | ${received} | ${r.status || ""} | ${r.combo || "-"}`;
    });
  } catch {
    return [];
  }
}

export type RecentLogEntry = {
  id: number;
  timestamp: string;
  model: string;
  provider: string;
  account: string;
  promptTokens: number | null;
  completionTokens: number | null;
  status: string;
  combo: string | null;
  detailsId: string | null;
};

export async function getRecentLogsStructured(limit: number = 300): Promise<RecentLogEntry[]> {
  if (isCloud) return [];
  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT id, timestamp, model, provider, account, prompt_tokens, completion_tokens, status, combo, details_id
         FROM request_log ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      timestamp: string;
      model: string;
      provider: string;
      account: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      status: string;
      combo: string | null;
      details_id: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      model: r.model || "-",
      provider: r.provider || "-",
      account: r.account || "-",
      promptTokens: r.prompt_tokens ?? null,
      completionTokens: r.completion_tokens ?? null,
      status: r.status || "",
      combo: r.combo || null,
      detailsId: r.details_id || null,
    }));
  } catch {
    return [];
  }
}

// ===== Read path =========================================================

type HistoryEntry = {
  timestamp: string;
  provider?: string | null;
  model?: string | null;
  connection_id?: string | null;
  api_key?: string | null;
  endpoint?: string | null;
  status?: string | null;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  data?: string;
};

function historyRow(r: HistoryEntry): {
  timestamp: string;
  provider: string;
  model: string;
  connectionId: string | null;
  apiKey: string | null;
  endpoint: string | null;
  status: string;
  tokens: UsageEntry["tokens"] | { prompt_tokens: number | null; completion_tokens: number | null };
  cost: number | null;
} {
  let blob: { tokens?: UsageEntry["tokens"] } = {};
  if (r.data) {
    try {
      blob = JSON.parse(r.data) as { tokens?: UsageEntry["tokens"] };
    } catch {
      blob = {};
    }
  }
  return {
    timestamp: r.timestamp,
    provider: r.provider || "",
    model: r.model || "",
    connectionId: r.connection_id || null,
    apiKey: r.api_key,
    endpoint: r.endpoint,
    status: r.status || "ok",
    tokens: blob.tokens || { prompt_tokens: r.prompt_tokens ?? null, completion_tokens: r.completion_tokens ?? null },
    cost: r.cost ?? null,
  };
}

export async function getUsageHistory(
  filter: { provider?: string; model?: string; startDate?: string; endDate?: string; limit?: number } = {},
): Promise<ReturnType<typeof historyRow>[]> {
  if (isCloud) return [];
  const db = getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.provider) {
    clauses.push("provider = ?");
    params.push(filter.provider);
  }
  if (filter.model) {
    clauses.push("model = ?");
    params.push(filter.model);
  }
  if (filter.startDate) {
    clauses.push("timestamp >= ?");
    params.push(new Date(filter.startDate).toISOString());
  }
  if (filter.endDate) {
    clauses.push("timestamp <= ?");
    params.push(new Date(filter.endDate).toISOString());
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit || 10000;
  const rows = db
    .prepare(`SELECT * FROM usage_history ${where} ORDER BY timestamp DESC LIMIT ?`)
    .all(...params, limit) as HistoryEntry[];
  return rows.map(historyRow);
}

export type ActiveRequest = { model: string; provider: string; account: string; count: number };
export type RecentRequest = {
  timestamp: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  status: string;
};
export type ActiveRequestsResult = {
  activeRequests: ActiveRequest[];
  recentRequests: RecentRequest[];
  errorProvider: string;
};

export async function getActiveRequests(): Promise<ActiveRequestsResult> {
  if (isCloud) {
    return { activeRequests: [], recentRequests: [], errorProvider: "" };
  }

  const db = getDatabase();

  // Active requests from in-memory pending state
  const connectionMap: Record<string, string> = {};
  try {
    const { getProviderConnections } = await import("@/lib/localDb");
    for (const c of await getProviderConnections()) {
      connectionMap[c.id] = c.name || c.email || c.id;
    }
  } catch {}

  const activeRequests: ActiveRequest[] = [];
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName,
          count,
        });
      }
    }
  }

  // Recent requests from last 20 usage_history rows
  const rows = db
    .prepare(`
    SELECT * FROM usage_history ORDER BY timestamp DESC LIMIT 200
  `)
    .all() as HistoryEntry[];
  const seen = new Set<string>();
  const recentRequests: RecentRequest[] = [];
  for (const r of rows) {
    const pt = r.prompt_tokens || 0;
    const ct = r.completion_tokens || 0;
    if (pt === 0 && ct === 0) continue;
    const minute = r.timestamp ? r.timestamp.slice(0, 16) : "";
    const key = `${r.model}|${r.provider}|${pt}|${ct}|${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentRequests.push({
      timestamp: r.timestamp,
      model: r.model || "",
      provider: r.provider || "",
      promptTokens: pt,
      completionTokens: ct,
      status: r.status || "ok",
    });
    if (recentRequests.length >= 20) break;
  }

  const errorProvider = Date.now() - lastErrorProvider.ts < 10000 ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

const PERIOD_MS: Record<string, number> = {
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
  "90d": 7776000000,
};

type StatsBucket = { requests: number; promptTokens: number; completionTokens: number; cost: number };
type LastUsedBucket = StatsBucket & { lastUsed?: string };
type ModelStatsBucket = StatsBucket & { rawModel: string; provider: string; lastUsed: string };
type AccountStatsBucket = StatsBucket & {
  rawModel: string;
  provider: string;
  connectionId: string;
  accountName: string;
  lastUsed: string;
};
type ApiKeyStatsBucket = StatsBucket & {
  rawModel: string;
  provider: string;
  apiKey: string | null;
  keyName: string;
  apiKeyKey: string;
  lastUsed: string;
};
type EndpointStatsBucket = StatsBucket & { endpoint: string; rawModel: string; provider: string; lastUsed: string };

export type UsageStatsResult = {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  byProvider: Record<string, StatsBucket>;
  byModel: Record<string, ModelStatsBucket>;
  byAccount: Record<string, AccountStatsBucket>;
  byApiKey: Record<string, ApiKeyStatsBucket>;
  byEndpoint: Record<string, EndpointStatsBucket>;
  last10Minutes: Array<{ requests: number; promptTokens: number; completionTokens: number; cost: number }>;
  pending: { byModel: Record<string, number>; byAccount: Record<string, Record<string, number>> };
  activeRequests: ActiveRequest[];
  recentRequests: RecentRequest[];
  errorProvider: string;
};

export async function getUsageStats(period: string = "all"): Promise<UsageStatsResult> {
  if (isCloud) {
    return {
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      byProvider: {},
      byModel: {},
      byAccount: {},
      byApiKey: {},
      byEndpoint: {},
      last10Minutes: [],
      pending: pendingRequests,
      activeRequests: [],
      recentRequests: [],
      errorProvider: "",
    };
  }

  const db = getDatabase();
  const { getProviderConnections, getApiKeys, getProviderNodes } = await import("@/lib/localDb");

  let allConnections: Array<{ id: string; name?: string; email?: string }> = [];
  try {
    allConnections = await getProviderConnections();
  } catch {}
  const connectionMap: Record<string, string> = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap: Record<string, string> = {};
  try {
    for (const n of await getProviderNodes()) {
      if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
    }
  } catch {}

  let allApiKeys: Array<{ id?: string; key: string; name?: string; createdAt?: string }> = [];
  try {
    allApiKeys = await getApiKeys();
  } catch {}
  const apiKeyMap: Record<string, { name?: string; id?: string; createdAt?: string }> = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };

  const { recentRequests } = await getActiveRequests();

  const stats: UsageStatsResult = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: {},
    byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: Date.now() - lastErrorProvider.ts < 10000 ? lastErrorProvider.provider : "",
  };

  // Active requests from pending
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName,
          count,
        });
      }
    }
  }

  // last10Minutes — live history
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap: Record<number, { requests: number; promptTokens: number; completionTokens: number; cost: number }> =
    {};
  for (let i = 0; i < 10; i++) {
    const bucketKey = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[bucketKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[bucketKey]);
  }
  const tenMinRows = db
    .prepare(`
    SELECT timestamp, prompt_tokens, completion_tokens, cost
    FROM usage_history WHERE timestamp >= ?
  `)
    .all(tenMinutesAgo.toISOString()) as Array<{
    timestamp: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  }>;
  for (const r of tenMinRows) {
    const et = new Date(r.timestamp).getTime();
    const bucket = Math.floor(et / 60000) * 60000;
    if (bucketMap[bucket]) {
      bucketMap[bucket].requests++;
      bucketMap[bucket].promptTokens += r.prompt_tokens || 0;
      bucketMap[bucket].completionTokens += r.completion_tokens || 0;
      bucketMap[bucket].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h";

  if (useDailySummary) {
    const periodDays: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    const maxDays = periodDays[period] || null;
    let whereClause = "";
    const params: unknown[] = [];
    if (maxDays !== null) {
      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - (maxDays - 1));
      const cutoffKey = getLocalDateKey(cutoff);
      whereClause = "WHERE date_key >= ?";
      params.push(cutoffKey);
    }

    const rows = db
      .prepare(`
      SELECT date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data
      FROM daily_summary ${whereClause}
    `)
      .all(...params) as Array<{
      date_key: string;
      bucket: string;
      key: string;
      requests?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      data?: string;
    }>;

    for (const r of rows) {
      let meta: { rawModel?: string; provider?: string; endpoint?: string; apiKey?: string } = {};
      if (r.data) {
        try {
          meta = JSON.parse(r.data) as typeof meta;
        } catch {
          meta = {};
        }
      }
      const prompt = r.prompt_tokens || 0;
      const completion = r.completion_tokens || 0;
      const cost = r.cost || 0;
      const requests = r.requests || 0;

      if (r.bucket === "day") {
        stats.totalPromptTokens += prompt;
        stats.totalCompletionTokens += completion;
        stats.totalCost += cost;
        continue;
      }

      if (r.bucket === "byProvider") {
        if (!stats.byProvider[r.key])
          stats.byProvider[r.key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
        const t = stats.byProvider[r.key];
        t.requests += requests;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
      } else if (r.bucket === "byModel") {
        const rawModel = meta.rawModel || r.key.split("|")[0];
        const provider = meta.provider || r.key.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel,
            provider: providerDisplayName,
            lastUsed: r.date_key,
          };
        }
        const t = stats.byModel[statsKey];
        t.requests += requests;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      } else if (r.bucket === "byAccount") {
        const connId = r.key;
        const rawModel = meta.rawModel || "";
        const provider = meta.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel,
            provider: providerDisplayName,
            connectionId: connId,
            accountName,
            lastUsed: r.date_key,
          };
        }
        const t = stats.byAccount[accountKey];
        t.requests += requests;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      } else if (r.bucket === "byApiKey") {
        const rawModel = meta.rawModel || "";
        const provider = meta.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const apiKeyVal = meta.apiKey;
        const keyInfo = apiKeyVal ? apiKeyMap[apiKeyVal] : null;
        const keyName = keyInfo?.name || (apiKeyVal ? apiKeyVal.slice(0, 8) + "..." : "Local (No API Key)");
        const apiKeyKey = apiKeyVal || "local-no-key";
        if (!stats.byApiKey[r.key]) {
          stats.byApiKey[r.key] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel,
            provider: providerDisplayName,
            apiKey: apiKeyVal || null,
            keyName,
            apiKeyKey,
            lastUsed: r.date_key,
          };
        }
        const t = stats.byApiKey[r.key];
        t.requests += requests;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      } else if (r.bucket === "byEndpoint") {
        const endpoint = meta.endpoint || r.key.split("|")[0] || "Unknown";
        const rawModel = meta.rawModel || "";
        const provider = meta.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[r.key]) {
          stats.byEndpoint[r.key] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            endpoint,
            rawModel,
            provider: providerDisplayName,
            lastUsed: r.date_key,
          };
        }
        const t = stats.byEndpoint[r.key];
        t.requests += requests;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (r.date_key > (t.lastUsed || "")) t.lastUsed = r.date_key;
      }
    }

    // Overlay lastUsed with precise ISO timestamps from usage_history rows
    // (daily_summary only has YYYY-MM-DD granularity).
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const overlayRows = maxDays
      ? db
          .prepare(
            `SELECT timestamp, provider, model, connection_id AS connectionId,
                  api_key AS apiKey, endpoint
             FROM usage_history WHERE timestamp >= ?`,
          )
          .all(new Date(overlayCutoff).toISOString())
      : db
          .prepare(
            `SELECT timestamp, provider, model, connection_id AS connectionId,
                  api_key AS apiKey, endpoint FROM usage_history
             ORDER BY timestamp DESC LIMIT 10000`,
          )
          .all();
    for (const entry of overlayRows as Array<{
      timestamp: string;
      provider?: string;
      model?: string;
      connectionId?: string;
      apiKey?: string;
      endpoint?: string;
    }>) {
      const ts = entry.timestamp;
      if (!ts || new Date(ts).getTime() < overlayCutoff) continue;

      const modelKey = entry.provider ? `${entry.model} (${entry.provider})` : entry.model;
      if (modelKey && stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) {
        stats.byModel[modelKey].lastUsed = ts;
      }

      if (entry.connectionId) {
        const accountName = connectionMap[entry.connectionId] || `Account ${entry.connectionId.slice(0, 8)}...`;
        const accountKey = `${entry.model} (${entry.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) {
          stats.byAccount[accountKey].lastUsed = ts;
        }
      }

      const apiKeyKey =
        entry.apiKey && typeof entry.apiKey === "string"
          ? `${entry.apiKey}|${entry.model}|${entry.provider || "unknown"}`
          : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) {
        stats.byApiKey[apiKeyKey].lastUsed = ts;
      }

      const endpoint = entry.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) {
        stats.byEndpoint[endpointKey].lastUsed = ts;
      }
    }
  } else {
    // 24h: scan usage_history
    const cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    const rows = db
      .prepare(`
      SELECT * FROM usage_history WHERE timestamp >= ?
    `)
      .all(cutoff) as HistoryEntry[];

    for (const r of rows) {
      const prompt = r.prompt_tokens || 0;
      const completion = r.completion_tokens || 0;
      const cost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider || ""] || r.provider;

      stats.totalPromptTokens += prompt;
      stats.totalCompletionTokens += completion;
      stats.totalCost += cost;

      if (r.provider) {
        if (!stats.byProvider[r.provider])
          stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
        const t = stats.byProvider[r.provider];
        t.requests++;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
      }

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model || "";
      if (modelKey) {
        if (!stats.byModel[modelKey]) {
          stats.byModel[modelKey] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel: r.model || "",
            provider: providerDisplayName || "",
            lastUsed: r.timestamp,
          };
        }
        const m = stats.byModel[modelKey];
        m.requests++;
        m.promptTokens += prompt;
        m.completionTokens += completion;
        m.cost += cost;
        if (new Date(r.timestamp) > new Date(m.lastUsed)) m.lastUsed = r.timestamp;
      }

      if (r.connection_id) {
        const accountName = connectionMap[r.connection_id] || `Account ${r.connection_id.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel: r.model || "",
            provider: providerDisplayName || "",
            connectionId: r.connection_id,
            accountName,
            lastUsed: r.timestamp,
          };
        }
        const t = stats.byAccount[accountKey];
        t.requests++;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
      }

      if (r.api_key && typeof r.api_key === "string") {
        const keyInfo = apiKeyMap[r.api_key];
        const keyName = keyInfo?.name || r.api_key.slice(0, 8) + "...";
        const apiKeyModelKey = `${r.api_key}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[apiKeyModelKey]) {
          stats.byApiKey[apiKeyModelKey] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel: r.model || "",
            provider: providerDisplayName || "",
            apiKey: r.api_key,
            keyName,
            apiKeyKey: r.api_key,
            lastUsed: r.timestamp,
          };
        }
        const t = stats.byApiKey[apiKeyModelKey];
        t.requests++;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            rawModel: r.model || "",
            provider: providerDisplayName || "",
            apiKey: null,
            keyName: "Local (No API Key)",
            apiKeyKey: "local-no-key",
            lastUsed: r.timestamp,
          };
        }
        const t = stats.byApiKey["local-no-key"];
        t.requests++;
        t.promptTokens += prompt;
        t.completionTokens += completion;
        t.cost += cost;
        if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const endpointModelKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[endpointModelKey]) {
        stats.byEndpoint[endpointModelKey] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          endpoint,
          rawModel: r.model || "",
          provider: providerDisplayName || "",
          lastUsed: r.timestamp,
        };
      }
      const t = stats.byEndpoint[endpointModelKey];
      t.requests++;
      t.promptTokens += prompt;
      t.completionTokens += completion;
      t.cost += cost;
      if (new Date(r.timestamp) > new Date(t.lastUsed)) t.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests =
    period === "all"
      ? readTotalRequests(db)
      : Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);

  return stats;
}

export type ChartBucket = {
  label: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  tokens: number;
  cost: number;
};

export async function getChartData(period: string = "7d"): Promise<ChartBucket[]> {
  if (isCloud) return [];
  const db = getDatabase();
  const now = Date.now();

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts: number): string =>
      new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets: ChartBucket[] = Array.from({ length: bucketCount }, (_, i) => {
      const ts = startTime + i * bucketMs;
      return { label: labelFn(ts), tokens: 0, cost: 0, requests: 0, promptTokens: 0, completionTokens: 0 };
    });

    const rows = db
      .prepare(`
      SELECT timestamp, prompt_tokens, completion_tokens, cost
      FROM usage_history WHERE timestamp >= ?
    `)
      .all(new Date(startTime).toISOString()) as Array<{
      timestamp: string;
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
    }>;

    for (const r of rows) {
      const et = new Date(r.timestamp).getTime();
      if (et < startTime || et > now) continue;
      const idx = Math.min(Math.floor((et - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].promptTokens += r.prompt_tokens || 0;
      buckets[idx].completionTokens += r.completion_tokens || 0;
      buckets[idx].tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
      buckets[idx].cost += r.cost || 0;
      buckets[idx].requests += 1;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const today = new Date();
  const labelFn = (d: Date): string => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const dayStart = new Date(today);
  dayStart.setDate(dayStart.getDate() - (bucketCount - 1));
  const dayRows = db
    .prepare(`
    SELECT date_key, prompt_tokens, completion_tokens, cost, requests
    FROM daily_summary
    WHERE bucket = 'day' AND date_key >= ?
  `)
    .all(getLocalDateKey(dayStart)) as Array<{
    date_key: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    requests?: number;
  }>;
  const byDate: Record<
    string,
    { prompt_tokens?: number; completion_tokens?: number; cost?: number; requests?: number }
  > = {};
  for (const r of dayRows) byDate[r.date_key] = r;

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = getLocalDateKey(d);
    const day = byDate[dateKey];
    return {
      label: labelFn(d),
      requests: day ? day.requests || 0 : 0,
      promptTokens: day ? day.prompt_tokens || 0 : 0,
      completionTokens: day ? day.completion_tokens || 0 : 0,
      tokens: day ? (day.prompt_tokens || 0) + (day.completion_tokens || 0) : 0,
      cost: day ? day.cost || 0 : 0,
    };
  });
}

export function getQueueDepths(): { logQueue: number; summaryQueue: number } {
  return {
    logQueue: logQueue.length,
    summaryQueue: summaryQueue?.length ?? 0,
  };
}

/**
 * Returns pending request counts for monitoring.
 * Aggregates byModel into per-provider totals.
 */
export function getPendingStats(): { total: number; byProvider: Record<string, number> } {
  const byProvider: Record<string, number> = {};
  let total = 0;
  for (const [modelKey, count] of Object.entries(pendingRequests.byModel)) {
    // modelKey format: "model (provider)" or bare "model"
    const match = modelKey.match(/\((.+)\)$/);
    const provider = match ? match[1] : "unknown";
    byProvider[provider] = (byProvider[provider] || 0) + count;
    total += count;
  }
  return { total, byProvider };
}

/**
 * Returns connection-name LRU cache stats for monitoring.
 */
export function getConnectionNameCacheStats(): ReturnType<LRUCache<string>["getStats"]> {
  return connectionNameCache.getStats();
}

// Re-export request details for back-compat (existing routes import these
// names from @/lib/usageDb)
export { generateDetailId, getRequestDetailById, getRequestDetails, saveRequestDetail } from "@/lib/requestDetailsDb";
