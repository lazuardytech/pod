// One-shot migration: import legacy lowdb JSON files into SQLite.
// Called from connection.js on first boot (when `meta.schema_version` is
// missing). Runs each file's import in its own transaction; on success the
// original JSON is renamed to `*.bak` so rollback is a rename-back away.

import fs from "node:fs";
import path from "node:path";
import { warn } from "@/sse/utils/logger";
import type { SqliteDatabase } from "./connection.ts";

const DB_JSON = "db.json";
const USAGE_JSON = "usage.json";
const REQUEST_DETAILS_JSON = "request-details.json";

interface ConfigDbData {
  providerConnections?: unknown[];
  providerNodes?: unknown[];
  proxyPools?: unknown[];
  combos?: unknown[];
  apiKeys?: unknown[];
  modelAliases?: Record<string, string>;
  customModels?: unknown[];
  settings?: Record<string, unknown>;
  pricing?: Record<string, Record<string, unknown>>;
}

interface UsageDbData {
  history?: unknown[];
  totalRequestsLifetime?: number;
  dailySummary?: Record<string, Record<string, unknown>>;
}

const STRUCTURED_CONN_FIELDS = new Set([
  "id",
  "provider",
  "authType",
  "name",
  "priority",
  "isActive",
  "createdAt",
  "updatedAt",
]);

const STRUCTURED_NODE_FIELDS = new Set([
  "id",
  "type",
  "name",
  "prefix",
  "apiType",
  "baseUrl",
  "createdAt",
  "updatedAt",
]);

const STRUCTURED_POOL_FIELDS = new Set(["id", "name", "proxyUrl", "type", "isActive", "createdAt", "updatedAt"]);

const STRUCTURED_COMBO_FIELDS = new Set(["id", "name", "createdAt", "updatedAt"]);

function pickExtraAsJson(obj: Record<string, unknown>, structured: Set<string>): string {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!structured.has(k)) extras[k] = v;
  }
  return JSON.stringify(extras);
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return null;
  const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn("sqlite", `could not parse ${filePath}, skipping`, { error: message });
    return null;
  }
}

function renameToBak(filePath: string) {
  try {
    fs.renameSync(/*turbopackIgnore: true*/ filePath, /*turbopackIgnore: true*/ `${filePath}.bak`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn("sqlite", `could not rename ${filePath} to .bak`, { error: message });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

interface ProviderConnection {
  id: string;
  provider: string;
  authType?: string;
  name?: string;
  priority?: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface ProviderNode {
  id: string;
  type?: string;
  name?: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface ProxyPool {
  id: string;
  name?: string;
  proxyUrl?: string;
  type?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface Combo {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface ApiKey {
  id: string;
  key: string;
  name?: string;
  machineId?: string;
  isActive?: boolean;
  limitType?: string;
  requestsPerMinute?: number;
  concurrentRequests?: number;
  createdAt?: string;
}

interface UsageEntry {
  timestamp: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKey?: unknown;
  endpoint?: string;
  status?: string;
  tokens?: Record<string, number>;
  cost?: number;
  [key: string]: unknown;
}

interface RequestDetailRecord {
  id: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  status?: string;
  latency?: number | { total?: number; totalMs?: number };
  tokens?: Record<string, number>;
  [key: string]: unknown;
}

interface DailyStats {
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  [key: string]: unknown;
}

function importConfigDb(db: SqliteDatabase, data: ConfigDbData): number {
  let imported = 0;

  if (Array.isArray(data.providerConnections)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO provider_connections
      (id, provider, auth_type, name, priority, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of data.providerConnections as ProviderConnection[]) {
      if (!c?.id || !c.provider) continue;
      stmt.run(
        c.id,
        c.provider,
        c.authType || null,
        c.name ?? null,
        c.priority ?? null,
        c.isActive === false ? 0 : 1,
        pickExtraAsJson(c, STRUCTURED_CONN_FIELDS),
        c.createdAt || nowIso(),
        c.updatedAt || c.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.providerNodes)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO provider_nodes
      (id, type, name, prefix, api_type, base_url, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of data.providerNodes as ProviderNode[]) {
      if (!n?.id) continue;
      stmt.run(
        n.id,
        n.type || null,
        n.name ?? null,
        n.prefix ?? null,
        n.apiType ?? null,
        n.baseUrl ?? null,
        pickExtraAsJson(n, STRUCTURED_NODE_FIELDS),
        n.createdAt || nowIso(),
        n.updatedAt || n.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.proxyPools)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO proxy_pools
      (id, name, proxy_url, type, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data.proxyPools as ProxyPool[]) {
      if (!p?.id) continue;
      stmt.run(
        p.id,
        p.name ?? null,
        p.proxyUrl ?? null,
        p.type || "http",
        p.isActive === false ? 0 : 1,
        pickExtraAsJson(p, STRUCTURED_POOL_FIELDS),
        p.createdAt || nowIso(),
        p.updatedAt || p.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.combos)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO combos
      (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const c of data.combos as Combo[]) {
      if (!c?.id) continue;
      stmt.run(
        c.id,
        c.name ?? null,
        pickExtraAsJson(c, STRUCTURED_COMBO_FIELDS),
        c.createdAt || nowIso(),
        c.updatedAt || c.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.apiKeys)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO api_keys
      (id, name, key, machine_id, is_active, created_at, limit_type, requests_per_minute, concurrent_requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const k of data.apiKeys as ApiKey[]) {
      if (!k?.id || !k.key) continue;
      const limitType = k.limitType === "limited" ? "limited" : "unlimited";
      const requestsPerMinute =
        limitType === "limited" && Number.isInteger(k.requestsPerMinute) && k.requestsPerMinute! > 0
          ? k.requestsPerMinute
          : null;
      const concurrentRequests =
        limitType === "limited" && Number.isInteger(k.concurrentRequests) && k.concurrentRequests! > 0
          ? k.concurrentRequests
          : null;
      stmt.run(
        k.id,
        k.name ?? null,
        k.key,
        k.machineId ?? null,
        k.isActive === false ? 0 : 1,
        k.createdAt || nowIso(),
        limitType,
        requestsPerMinute,
        concurrentRequests,
      );
      imported++;
    }
  }

  if (data.modelAliases && typeof data.modelAliases === "object") {
    const stmt = db.prepare("INSERT OR REPLACE INTO model_aliases (alias, target) VALUES (?, ?)");
    for (const [alias, target] of Object.entries(data.modelAliases)) {
      if (typeof target !== "string") continue;
      stmt.run(alias, target);
      imported++;
    }
  }

  if (Array.isArray(data.customModels)) {
    const stmt = db.prepare("INSERT OR IGNORE INTO custom_models (provider_alias, id, type, name) VALUES (?, ?, ?, ?)");
    for (const m of data.customModels as Record<string, string>[]) {
      if (!m?.providerAlias || !m?.id) continue;
      stmt.run(m.providerAlias, m.id, m.type || "llm", m.name || m.id);
      imported++;
    }
  }

  if (data.settings && typeof data.settings === "object") {
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(data.settings)) {
      stmt.run(k, JSON.stringify(v));
      imported++;
    }
  }

  if (data.pricing && typeof data.pricing === "object") {
    const stmt = db.prepare("INSERT OR REPLACE INTO pricing (provider, model, data) VALUES (?, ?, ?)");
    for (const [provider, models] of Object.entries(data.pricing)) {
      if (!models || typeof models !== "object") continue;
      for (const [model, priceObj] of Object.entries(models)) {
        stmt.run(provider, model, JSON.stringify(priceObj ?? {}));
        imported++;
      }
    }
  }

  return imported;
}

function importUsageDb(db: SqliteDatabase, data: UsageDbData): number {
  let imported = 0;

  if (Array.isArray(data.history)) {
    const stmt = db.prepare(`
      INSERT INTO usage_history
      (timestamp, provider, model, connection_id, api_key, endpoint, status,
       prompt_tokens, completion_tokens, cost, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of data.history as UsageEntry[]) {
      if (!e?.timestamp) continue;
      const t = e.tokens || {};
      const prompt = t.prompt_tokens ?? t.input_tokens ?? 0;
      const completion = t.completion_tokens ?? t.output_tokens ?? 0;
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e)) {
        if (
          ![
            "timestamp",
            "provider",
            "model",
            "connectionId",
            "apiKey",
            "endpoint",
            "status",
            "tokens",
            "cost",
          ].includes(k)
        ) {
          rest[k] = v;
        }
      }
      rest.tokens = t;
      stmt.run(
        e.timestamp,
        e.provider || null,
        e.model || null,
        e.connectionId || null,
        typeof e.apiKey === "string" ? e.apiKey : null,
        e.endpoint || null,
        e.status || null,
        prompt,
        completion,
        e.cost || 0,
        JSON.stringify(rest),
      );
      imported++;
    }
  }

  if (typeof data.totalRequestsLifetime === "number") {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('totalRequestsLifetime', ?)").run(
      String(data.totalRequestsLifetime),
    );
  }

  if (data.dailySummary && typeof data.dailySummary === "object") {
    const dayStmt = db.prepare(`
      INSERT OR REPLACE INTO daily_summary
      (date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [dateKey, day] of Object.entries(data.dailySummary)) {
      if (!day || typeof day !== "object") continue;
      const d = day as DailyStats;
      dayStmt.run(
        dateKey,
        "day",
        "_",
        d.requests || 0,
        d.promptTokens || 0,
        d.completionTokens || 0,
        d.cost || 0,
        null,
      );
      for (const bucket of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
        const obj = d[bucket];
        if (!obj || typeof obj !== "object") continue;
        for (const [k, v] of Object.entries(obj as Record<string, DailyStats>)) {
          const { requests, promptTokens, completionTokens, cost, ...meta } = v || {};
          dayStmt.run(
            dateKey,
            bucket,
            k,
            requests || 0,
            promptTokens || 0,
            completionTokens || 0,
            cost || 0,
            Object.keys(meta).length ? JSON.stringify(meta) : null,
          );
        }
      }
      imported++;
    }
  }

  return imported;
}

function importRequestDetails(db: SqliteDatabase, data: { records?: RequestDetailRecord[] }): number {
  if (!Array.isArray(data.records)) return 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO request_details
    (id, timestamp, provider, model, connection_id, status, latency_ms,
     prompt_tokens, completion_tokens, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  for (const r of data.records) {
    if (!r?.id) continue;
    const latency = typeof r.latency === "number" ? r.latency : (r.latency?.total ?? r.latency?.totalMs ?? null);
    const t = r.tokens || {};
    const rest: Record<string, unknown> = { ...r };
    delete rest.id;
    delete rest.timestamp;
    delete rest.provider;
    delete rest.model;
    delete rest.connectionId;
    delete rest.status;
    stmt.run(
      r.id,
      r.timestamp || nowIso(),
      r.provider || null,
      r.model || null,
      r.connectionId || null,
      r.status || null,
      latency,
      t.prompt_tokens ?? t.input_tokens ?? null,
      t.completion_tokens ?? t.output_tokens ?? null,
      JSON.stringify(rest),
    );
    imported++;
  }
  return imported;
}

export interface MigrationSummary {
  imported: number;
  files: { file: string; rows: number }[];
}

// Public entry — runs inside the caller's transaction scope if wrapped.
// Each legacy file is imported in its own transaction so a corrupt file
// doesn't block the others.
export function migrateFromJson(db: SqliteDatabase, dataDir: string): MigrationSummary {
  const summary: MigrationSummary = { imported: 0, files: [] };

  const cfgPath = path.join(/*turbopackIgnore: true*/ dataDir, DB_JSON);
  const cfg = readJson(cfgPath) as ConfigDbData | null;
  if (cfg) {
    const count = db.transaction(() => importConfigDb(db, cfg)).immediate?.() ?? 0;
    summary.imported += count;
    summary.files.push({ file: DB_JSON, rows: count });
    renameToBak(cfgPath);
  }

  const usagePath = path.join(/*turbopackIgnore: true*/ dataDir, USAGE_JSON);
  const usage = readJson(usagePath) as UsageDbData | null;
  if (usage) {
    const count = db.transaction(() => importUsageDb(db, usage)).immediate?.() ?? 0;
    summary.imported += count;
    summary.files.push({ file: USAGE_JSON, rows: count });
    renameToBak(usagePath);
  }

  const rdPath = path.join(/*turbopackIgnore: true*/ dataDir, REQUEST_DETAILS_JSON);
  const rd = readJson(rdPath) as { records?: RequestDetailRecord[] } | null;
  if (rd) {
    const count = db.transaction(() => importRequestDetails(db, rd)).immediate?.() ?? 0;
    summary.imported += count;
    summary.files.push({ file: REQUEST_DETAILS_JSON, rows: count });
    renameToBak(rdPath);
  }

  return summary;
}
