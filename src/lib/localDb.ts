// Public config DB facade. SQLite-backed on Node; in-memory lowdb stub on
// Cloudflare Workers. Public API surface unchanged from the previous
// lowdb+JSON implementation so the 35+ consumer files keep working.

import { timingSafeEqual } from "node:crypto";
import { Low } from "lowdb";
import { v4 as uuidv4 } from "uuid";
import { getDatabase, type SqliteDatabase, tx } from "./sqlite/connection.ts";

// ===== Types =============================================================

export interface ProviderConnection {
  id: string;
  provider: string;
  authType?: string;
  name: string | null;
  priority: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ProviderNode {
  id: string;
  type: string;
  name: string;
  prefix: string;
  apiType: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ProxyPool {
  id: string;
  name: string;
  proxyUrl: string;
  type: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface Combo {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  machineId: string;
  isActive: boolean;
  createdAt: string;
  lastAccessAt: string | null;
  limitType: "limited" | "unlimited";
  requestsPerMinute: number | null;
  concurrentRequests: number | null;
}

export interface CustomModel {
  providerAlias: string;
  id: string;
  type: string;
  name: string;
}

// ===== Internal Row Types (SQLite column shapes) =========================

interface ProviderConnectionRow {
  id: string;
  provider: string;
  auth_type: string | null;
  name: string | null;
  priority: number | null;
  is_active: number;
  data: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderNodeRow {
  id: string;
  type: string;
  name: string;
  prefix: string;
  api_type: string;
  base_url: string;
  data: string | null;
  created_at: string;
  updated_at: string;
}

interface ProxyPoolRow {
  id: string;
  name: string;
  proxy_url: string;
  type: string;
  is_active: number;
  data: string | null;
  created_at: string;
  updated_at: string;
}

interface ComboRow {
  id: string;
  name: string;
  data: string | null;
  created_at: string;
  updated_at: string;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key: string;
  machine_id: string;
  is_active: number;
  created_at: string;
  last_access_at: string | null;
  limit_type: string;
  requests_per_minute: number | null;
  concurrent_requests: number | null;
}

interface AliasRow {
  alias: string;
  target: string;
}

interface CustomModelRow {
  provider_alias: string;
  id: string;
  type: string;
  name: string;
}

interface PricingRow {
  provider: string;
  model: string;
  data: string | null;
}

// ===== CloudData (in-memory store for Workers path) ======================

interface CloudData {
  providerConnections: ProviderConnection[];
  providerNodes: ProviderNode[];
  proxyPools: ProxyPool[];
  modelAliases: Record<string, string>;
  customModels: CustomModel[];
  combos: Combo[];
  apiKeys: ApiKey[];
  settings: Record<string, unknown>;
  pricing: Record<string, Record<string, unknown>>;
}

// ===== Filter Types ======================================================

interface ProviderConnectionFilter {
  provider?: string;
  isActive?: boolean;
}

interface ProviderNodeFilter {
  type?: string;
}

interface ProxyPoolFilter {
  isActive?: boolean;
  testStatus?: string;
}

// ===== Constants =========================================================

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {} as Record<string, unknown>,
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {} as Record<string, unknown>,
  requireLogin: true,
  tunnelDashboardAccess: true,
  observabilityEnabled: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 1024,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  dnsToolEnabled: {} as Record<string, unknown>,
  rtkEnabled: false,
  modelCostSyncIntervalHours: 1,
  cavemanEnabled: false,
  cavemanLevel: "full",
  semanticCacheEnabled: false,
  semanticCacheMaxSize: 100,
  semanticCacheTTL: 1800000,
  memoryEnabled: true,
  memoryMaxTokens: 2000,
  memoryRetentionDays: 30,
  memoryStrategy: "hybrid",
};

export type Settings = typeof DEFAULT_SETTINGS & { [key: string]: unknown };

function cloneDefaultData(): CloudData {
  return {
    providerConnections: [],
    providerNodes: [],
    proxyPools: [],
    modelAliases: {},
    customModels: [],
    combos: [],
    apiKeys: [],
    settings: { ...DEFAULT_SETTINGS },
    pricing: {},
  };
}

// ===== Cloud/Workers branch — in-memory only, no persistence ==============

const isCloud = typeof caches !== "undefined" || typeof caches === "object";

let cloudDb: Low<CloudData> | null = null;

async function getCloudDb(): Promise<Low<CloudData>> {
  if (!cloudDb) {
    const data = cloneDefaultData();
    cloudDb = new Low<CloudData>(
      { read: () => Promise.resolve(null as CloudData | null), write: async () => {} },
      data,
    );
    cloudDb.data = data;
  }
  return cloudDb;
}

// ===== Node SQLite branch ================================================

// `getDatabase()` is itself lazy — it opens better-sqlite3 on first call, so
// simply re-exposing it keeps the cloud branch from ever touching the
// native module.
const db: () => SqliteDatabase = getDatabase;

const CONN_COLS = new Set<string>([
  "id",
  "provider",
  "authType",
  "name",
  "priority",
  "isActive",
  "createdAt",
  "updatedAt",
]);
const NODE_COLS = new Set<string>(["id", "type", "name", "prefix", "apiType", "baseUrl", "createdAt", "updatedAt"]);
const POOL_COLS = new Set<string>(["id", "name", "proxyUrl", "type", "isActive", "createdAt", "updatedAt"]);
const COMBO_COLS = new Set<string>(["id", "name", "createdAt", "updatedAt"]);

function splitExtras(obj: Record<string, unknown>, cols: Set<string>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!cols.has(k)) extras[k] = v;
  }
  return extras;
}

function parseExtras(text: string | null): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rowToConnection(r: ProviderConnectionRow): ProviderConnection {
  return {
    ...parseExtras(r.data),
    id: r.id,
    provider: r.provider,
    authType: r.auth_type || undefined,
    name: r.name ?? null,
    priority: r.priority ?? null,
    isActive: r.is_active !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToNode(r: ProviderNodeRow): ProviderNode {
  return {
    ...parseExtras(r.data),
    id: r.id,
    type: r.type,
    name: r.name,
    prefix: r.prefix,
    apiType: r.api_type,
    baseUrl: r.base_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToPool(r: ProxyPoolRow): ProxyPool {
  return {
    ...parseExtras(r.data),
    id: r.id,
    name: r.name,
    proxyUrl: r.proxy_url,
    type: r.type,
    isActive: r.is_active !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToCombo(r: ComboRow): Combo {
  return {
    ...parseExtras(r.data),
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToApiKey(r: ApiKeyRow): ApiKey {
  const limitType: "limited" | "unlimited" = r.limit_type === "limited" ? "limited" : "unlimited";
  const requestsPerMinuteRaw = r.requests_per_minute;
  const concurrentRequestsRaw = r.concurrent_requests;
  const requestsPerMinute =
    limitType === "limited" &&
    Number.isInteger(requestsPerMinuteRaw) &&
    requestsPerMinuteRaw &&
    requestsPerMinuteRaw > 0
      ? requestsPerMinuteRaw
      : null;
  const concurrentRequests =
    limitType === "limited" &&
    Number.isInteger(concurrentRequestsRaw) &&
    concurrentRequestsRaw &&
    concurrentRequestsRaw > 0
      ? concurrentRequestsRaw
      : null;

  return {
    id: r.id,
    name: r.name,
    key: r.key,
    machineId: r.machine_id,
    isActive: r.is_active !== 0,
    createdAt: r.created_at,
    lastAccessAt: r.last_access_at || null,
    limitType,
    requestsPerMinute,
    concurrentRequests,
  };
}

function toPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number <= 0) return null;
  return number;
}

function normalizeApiKeyRateLimitInput(
  input: Record<string, unknown> = {},
  fallback: Record<string, unknown> = {},
): { limitType: "limited" | "unlimited"; requestsPerMinute: number | null; concurrentRequests: number | null } {
  const requestedType = input.limitType ?? fallback.limitType;
  const limitType: "limited" | "unlimited" = requestedType === "limited" ? "limited" : "unlimited";

  const fallbackRpm =
    fallback.limitType === "limited" && Number.isInteger(fallback.requestsPerMinute)
      ? (fallback.requestsPerMinute as number)
      : null;
  const fallbackConcurrent =
    fallback.limitType === "limited" && Number.isInteger(fallback.concurrentRequests)
      ? (fallback.concurrentRequests as number)
      : null;

  const rpmCandidate = (input.requestsPerMinute ?? fallbackRpm) as number | null;
  const concurrentCandidate = (input.concurrentRequests ?? fallbackConcurrent) as number | null;

  if (limitType === "limited") {
    const requestsPerMinute = toPositiveInteger(rpmCandidate);
    const concurrentRequests = toPositiveInteger(concurrentCandidate);
    if (!requestsPerMinute) throw new Error("requestsPerMinute must be a positive integer");
    if (!concurrentRequests) throw new Error("concurrentRequests must be a positive integer");
    return { limitType, requestsPerMinute, concurrentRequests };
  }

  return {
    limitType: "unlimited",
    requestsPerMinute: null,
    concurrentRequests: null,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ===== Provider Connections ==============================================

export async function getProviderConnections(filter: ProviderConnectionFilter = {}): Promise<ProviderConnection[]> {
  if (isCloud) {
    const d = await getCloudDb();
    let list = d.data.providerConnections || [];
    if (filter.provider) list = list.filter((c) => c.provider === filter.provider);
    if (filter.isActive !== undefined) list = list.filter((c) => c.isActive === filter.isActive);
    return [...list].sort((a, b) => ((a.priority as number) || 999) - ((b.priority as number) || 999));
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.provider) {
    clauses.push("provider = ?");
    params.push(filter.provider);
  }
  if (filter.isActive !== undefined) {
    clauses.push("is_active = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(`SELECT * FROM provider_connections ${where} ORDER BY COALESCE(priority, 999), updated_at DESC`)
    .all(...params) as ProviderConnectionRow[];
  return rows.map(rowToConnection);
}

export async function getProviderConnectionById(id: string): Promise<ProviderConnection | null> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.providerConnections.find((c) => c.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as
    | ProviderConnectionRow
    | undefined;
  return r ? rowToConnection(r) : null;
}

function insertConnectionRowInTx(database: SqliteDatabase, conn: ProviderConnection): void {
  const extras = splitExtras(conn, CONN_COLS);
  database
    .prepare(`
    INSERT INTO provider_connections
    (id, provider, auth_type, name, priority, is_active, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      conn.id,
      conn.provider,
      conn.authType || null,
      conn.name ?? null,
      conn.priority ?? null,
      conn.isActive === false ? 0 : 1,
      JSON.stringify(extras),
      conn.createdAt,
      conn.updatedAt,
    );
}

function updateConnectionRow(id: string, patch: Record<string, unknown>): ProviderConnection | null {
  return tx((db) => {
    const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as
      | ProviderConnectionRow
      | undefined;
    if (!row) return null;
    const current = rowToConnection(row);
    const merged = { ...current, ...patch, updatedAt: nowIso() } as ProviderConnection;
    const extras = splitExtras(merged, CONN_COLS);
    db.prepare(`
    UPDATE provider_connections
    SET provider = ?, auth_type = ?, name = ?, priority = ?, is_active = ?,
        data = ?, updated_at = ?
    WHERE id = ?
  `).run(
      merged.provider,
      merged.authType || null,
      merged.name ?? null,
      merged.priority ?? null,
      merged.isActive === false ? 0 : 1,
      JSON.stringify(extras),
      merged.updatedAt,
      id,
    );
    return merged;
  });
}

export async function createProviderConnection(data: Record<string, unknown>): Promise<ProviderConnection> {
  if (isCloud) return createProviderConnectionCloud(data);

  // Wrap SELECT + INSERT/UPDATE in transaction to prevent duplicate rows
  // from concurrent upsert calls. Reorder runs after tx commits.
  let connection: ProviderConnection | undefined;
  let isNew = false;
  tx((db) => {
    const now = nowIso();
    let existing: ProviderConnectionRow | undefined;
    if (data.authType === "oauth" && data.email) {
      existing = db
        .prepare(`
      SELECT * FROM provider_connections
      WHERE provider = ? AND auth_type = 'oauth'
        AND json_extract(data, '$.email') = ?
    `)
        .get(data.provider, data.email) as ProviderConnectionRow | undefined;
    } else if (data.authType === "apikey" && data.name) {
      existing = db
        .prepare(`
      SELECT * FROM provider_connections
      WHERE provider = ? AND auth_type = 'apikey' AND name = ?
    `)
        .get(data.provider, data.name) as ProviderConnectionRow | undefined;
    }

    if (existing) {
      const current = rowToConnection(existing);
      connection = { ...current, ...data, updatedAt: now } as ProviderConnection;
      const extras = splitExtras(connection, CONN_COLS);
      db.prepare(`
      UPDATE provider_connections
      SET provider = ?, auth_type = ?, name = ?, priority = ?, is_active = ?,
          data = ?, updated_at = ?
      WHERE id = ?
    `).run(
        connection.provider,
        connection.authType || null,
        connection.name ?? null,
        connection.priority ?? null,
        connection.isActive === false ? 0 : 1,
        JSON.stringify(extras),
        now,
        current.id,
      );
      return;
    }

    // New connection: derive default name + next priority
    let connectionName = (data.name as string) || null;
    if (!connectionName && data.authType === "oauth") {
      if (data.email) {
        connectionName = data.email as string;
      } else {
        const row = db
          .prepare("SELECT COUNT(*) as c FROM provider_connections WHERE provider = ?")
          .get(data.provider) as { c: number } | undefined;
        connectionName = `Account ${(row?.c || 0) + 1}`;
      }
    }

    let priority = data.priority as number | undefined;
    if (!priority) {
      const row = db
        .prepare("SELECT COALESCE(MAX(priority), 0) as m FROM provider_connections WHERE provider = ?")
        .get(data.provider) as { m: number } | undefined;
      priority = (row?.m || 0) + 1;
    }

    connection = {
      id: uuidv4(),
      provider: data.provider as string,
      authType: (data.authType as string) || "oauth",
      name: connectionName,
      priority,
      isActive: data.isActive !== undefined ? (data.isActive as boolean) : true,
      createdAt: now,
      updatedAt: now,
    };

    const optionalFields = [
      "displayName",
      "email",
      "globalPriority",
      "defaultModel",
      "accessToken",
      "refreshToken",
      "expiresAt",
      "tokenType",
      "scope",
      "idToken",
      "projectId",
      "apiKey",
      "testStatus",
      "lastTested",
      "lastError",
      "lastErrorAt",
      "rateLimitedUntil",
      "expiresIn",
      "errorCode",
      "consecutiveUseCount",
    ];
    for (const f of optionalFields) {
      if (data[f] !== undefined && data[f] !== null) (connection as Record<string, unknown>)[f] = data[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData as Record<string, unknown>).length) {
      (connection as Record<string, unknown>).providerSpecificData = data.providerSpecificData;
    }

    // Insert inside the transaction
    insertConnectionRowInTx(db, connection);
    isNew = true;
  });

  if (isNew) {
    await reorderProviderConnections((connection as ProviderConnection).provider);
  }
  return connection as ProviderConnection;
}

// Cloud copy of createProviderConnection — kept isolated so the SQLite
// path stays readable.
async function createProviderConnectionCloud(data: Record<string, unknown>): Promise<ProviderConnection> {
  const d = await getCloudDb();
  const now = nowIso();
  let idx = -1;
  if (data.authType === "oauth" && data.email) {
    idx = d.data.providerConnections.findIndex(
      (c) => c.provider === data.provider && c.authType === "oauth" && c.email === data.email,
    );
  } else if (data.authType === "apikey" && data.name) {
    idx = d.data.providerConnections.findIndex(
      (c) => c.provider === data.provider && c.authType === "apikey" && c.name === data.name,
    );
  }
  if (idx !== -1) {
    d.data.providerConnections[idx] = {
      ...d.data.providerConnections[idx],
      ...data,
      updatedAt: now,
    } as ProviderConnection;
    return d.data.providerConnections[idx]!;
  }
  let name = (data.name as string) || undefined;
  if (!name && data.authType === "oauth") {
    name =
      (data.email as string) ||
      `Account ${d.data.providerConnections.filter((c) => c.provider === data.provider).length + 1}`;
  }
  let priority = data.priority as number | undefined;
  if (!priority) {
    const max = d.data.providerConnections
      .filter((c) => c.provider === data.provider)
      .reduce((m, c) => Math.max(m, (c.priority as number) || 0), 0);
    priority = max + 1;
  }
  const connection: ProviderConnection = {
    id: uuidv4(),
    provider: data.provider as string,
    authType: (data.authType as string) || "oauth",
    name: name || null,
    priority: priority || null,
    isActive: data.isActive !== undefined ? (data.isActive as boolean) : true,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  d.data.providerConnections.push(connection);
  return connection;
}

export async function updateProviderConnection(
  id: string,
  data: Record<string, unknown>,
): Promise<ProviderConnection | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = d.data.providerConnections.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const providerId = d.data.providerConnections[idx]!.provider;
    d.data.providerConnections[idx] = {
      ...d.data.providerConnections[idx],
      ...data,
      updatedAt: nowIso(),
    } as ProviderConnection;
    if (data.priority !== undefined) await reorderProviderConnections(providerId);
    return d.data.providerConnections[idx];
  }

  const merged = updateConnectionRow(id, data);
  if (!merged) return null;
  if (data.priority !== undefined) await reorderProviderConnections(merged.provider);
  return merged;
}

export async function deleteProviderConnection(id: string): Promise<boolean> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = d.data.providerConnections.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    const providerId = d.data.providerConnections[idx]!.provider;
    d.data.providerConnections.splice(idx, 1);
    await reorderProviderConnections(providerId);
    return true;
  }
  const current = await getProviderConnectionById(id);
  if (!current) return false;
  db().prepare("DELETE FROM provider_connections WHERE id = ?").run(id);
  await reorderProviderConnections(current.provider);
  return true;
}

export async function deleteProviderConnectionsByProvider(providerId: string): Promise<number> {
  if (isCloud) {
    const d = await getCloudDb();
    const before = d.data.providerConnections.length;
    d.data.providerConnections = d.data.providerConnections.filter((c) => c.provider !== providerId);
    return before - d.data.providerConnections.length;
  }
  const r = db().prepare("DELETE FROM provider_connections WHERE provider = ?").run(providerId) as { changes: number };
  return r.changes;
}

export async function reorderProviderConnections(providerId: string): Promise<void> {
  if (isCloud) {
    const d = await getCloudDb();
    const list = d.data.providerConnections
      .filter((c) => c.provider === providerId)
      .sort((a, b) => {
        const p = ((a.priority as number) || 0) - ((b.priority as number) || 0);
        return p !== 0 ? p : new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
    list.forEach((c, i) => {
      c.priority = i + 1;
    });
    return;
  }
  const rows = db()
    .prepare(`
    SELECT id FROM provider_connections
    WHERE provider = ?
    ORDER BY COALESCE(priority, 0), updated_at DESC
  `)
    .all(providerId) as { id: string }[];
  const upd = db().prepare("UPDATE provider_connections SET priority = ? WHERE id = ?");
  const runAll = db().transaction(() => {
    rows.forEach((r, i) => upd.run(i + 1, r.id));
  });
  runAll();
}

// ===== Provider Nodes ====================================================

export async function getProviderNodes(filter: ProviderNodeFilter = {}): Promise<ProviderNode[]> {
  if (isCloud) {
    const d = await getCloudDb();
    let list = d.data.providerNodes || [];
    if (filter.type) list = list.filter((n) => n.type === filter.type);
    return list;
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.type) {
    clauses.push("type = ?");
    params.push(filter.type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(`SELECT * FROM provider_nodes ${where}`)
    .all(...params) as ProviderNodeRow[];
  return rows.map(rowToNode);
}

export async function getProviderNodeById(id: string): Promise<ProviderNode | null> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.providerNodes.find((n) => n.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM provider_nodes WHERE id = ?").get(id) as ProviderNodeRow | undefined;
  return r ? rowToNode(r) : null;
}

export async function createProviderNode(data: Record<string, unknown>): Promise<ProviderNode> {
  const now = nowIso();
  const node: ProviderNode = {
    id: (data.id as string) || uuidv4(),
    type: data.type as string,
    name: data.name as string,
    prefix: data.prefix as string,
    apiType: data.apiType as string,
    baseUrl: data.baseUrl as string,
    createdAt: now,
    updatedAt: now,
  };
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.providerNodes) d.data.providerNodes = [];
    d.data.providerNodes.push(node);
    return node;
  }
  const extras = splitExtras(node, NODE_COLS);
  db()
    .prepare(`
    INSERT INTO provider_nodes
    (id, type, name, prefix, api_type, base_url, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      node.id,
      node.type || null,
      node.name ?? null,
      node.prefix ?? null,
      node.apiType ?? null,
      node.baseUrl ?? null,
      JSON.stringify(extras),
      node.createdAt,
      node.updatedAt,
    );
  return node;
}

export async function updateProviderNode(id: string, data: Record<string, unknown>): Promise<ProviderNode | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.providerNodes || []).findIndex((n) => n.id === id);
    if (idx === -1) return null;
    d.data.providerNodes[idx] = { ...d.data.providerNodes[idx], ...data, updatedAt: nowIso() } as ProviderNode;
    return d.data.providerNodes[idx];
  }
  const current = await getProviderNodeById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: nowIso() } as ProviderNode;
  const extras = splitExtras(merged, NODE_COLS);
  db()
    .prepare(`
    UPDATE provider_nodes
    SET type = ?, name = ?, prefix = ?, api_type = ?, base_url = ?,
        data = ?, updated_at = ?
    WHERE id = ?
  `)
    .run(
      merged.type || null,
      merged.name ?? null,
      merged.prefix ?? null,
      merged.apiType ?? null,
      merged.baseUrl ?? null,
      JSON.stringify(extras),
      merged.updatedAt,
      id,
    );
  return merged;
}

export async function deleteProviderNode(id: string): Promise<ProviderNode | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.providerNodes || []).findIndex((n) => n.id === id);
    if (idx === -1) return null;
    const [removed] = d.data.providerNodes.splice(idx, 1);
    return removed ?? null;
  }
  const current = await getProviderNodeById(id);
  if (!current) return null;
  db().prepare("DELETE FROM provider_nodes WHERE id = ?").run(id);
  return current;
}

// Rewrite a combo's `models` array, replacing any "<oldId>/<model>" entry
// with "<newId>/<model>". Returns the new array if anything changed, else null.
function rewriteComboModels(models: unknown, oldId: string, newId: string): string[] | null {
  if (!Array.isArray(models)) return null;
  let changed = false;
  const prefix = `${oldId}/`;
  const next = (models as string[]).map((m) => {
    if (typeof m === "string" && m.startsWith(prefix)) {
      changed = true;
      return `${newId}/${m.slice(prefix.length)}`;
    }
    return m;
  });
  return changed ? next : null;
}

// Rewrite alias targets like "<oldId>/<model>" → "<newId>/<model>".
function rewriteAliasTarget(target: unknown, oldId: string, newId: string): string | null {
  if (typeof target !== "string") return null;
  const prefix = `${oldId}/`;
  if (!target.startsWith(prefix)) return null;
  return `${newId}/${target.slice(prefix.length)}`;
}

/**
 * Rename a custom provider node's identifier. Cascades the change across all
 * tables and JSON blobs that reference the old id. Atomic via SQLite
 * transaction.
 *
 * Tracks rename history in `node.previousIds` so URL redirects from old ids
 * keep working.
 *
 * Throws on:
 *  - source node missing
 *  - newId conflicts with another existing node
 *  - newId is empty / equals oldId
 *
 * Returns the updated node.
 */
export async function renameProviderNode(oldId: string, newId: string): Promise<ProviderNode> {
  if (!oldId || !newId) throw new Error("Both oldId and newId are required");
  if (oldId === newId) throw new Error("newId must differ from oldId");

  if (isCloud) {
    const d = await getCloudDb();
    const node = (d.data.providerNodes || []).find((n) => n.id === oldId);
    if (!node) throw new Error("Provider node not found");
    if ((d.data.providerNodes || []).some((n) => n.id === newId)) {
      throw new Error("Identifier already in use");
    }
    const now = nowIso();
    node.previousIds = Array.from(new Set([...((node.previousIds as string[]) || []), oldId]));
    node.id = newId;
    node.updatedAt = now;
    for (const c of d.data.providerConnections || []) {
      if (c.provider === oldId) c.provider = newId;
    }
    for (const m of d.data.customModels || []) {
      if (m.providerAlias === oldId) m.providerAlias = newId;
    }
    if (d.data.pricing && d.data.pricing[oldId]) {
      d.data.pricing[newId] = d.data.pricing[oldId];
      delete d.data.pricing[oldId];
    }
    for (const combo of d.data.combos || []) {
      const next = rewriteComboModels(combo.models, oldId, newId);
      if (next) combo.models = next;
    }
    for (const [alias, target] of Object.entries(d.data.modelAliases || {})) {
      const rewritten = rewriteAliasTarget(target, oldId, newId);
      if (rewritten) d.data.modelAliases[alias] = rewritten;
    }
    const settings = d.data.settings || {};
    for (const key of ["providerStrategies", "providerThinking"]) {
      if (settings[key] && (settings[key] as Record<string, unknown>)[oldId] !== undefined) {
        const map = settings[key] as Record<string, unknown>;
        map[newId] = map[oldId];
        delete map[oldId];
      }
    }
    return node;
  }

  const current = await getProviderNodeById(oldId);
  if (!current) throw new Error("Provider node not found");
  const conflict = db().prepare("SELECT id FROM provider_nodes WHERE id = ?").get(newId) as { id: string } | undefined;
  if (conflict) throw new Error("Identifier already in use");

  // Pre-compute JSON rewrites outside the transaction (read-only work).
  const comboRows = db().prepare("SELECT id, data FROM combos").all() as { id: string; data: string | null }[];
  const comboUpdates: { id: string; data: string }[] = [];
  for (const row of comboRows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data || "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const next = rewriteComboModels(parsed.models, oldId, newId);
    if (next) {
      parsed.models = next;
      comboUpdates.push({ id: row.id, data: JSON.stringify(parsed) });
    }
  }

  const aliasRows = db()
    .prepare("SELECT alias, target FROM model_aliases WHERE target LIKE ?")
    .all(`${oldId}/%`) as AliasRow[];
  const aliasUpdates = aliasRows
    .map((r) => ({ alias: r.alias, target: rewriteAliasTarget(r.target, oldId, newId) }))
    .filter((u): u is { alias: string; target: string } => u.target !== null);

  const settings = await getSettings();
  const settingsPatches: Record<string, Record<string, unknown>> = {};
  for (const key of ["providerStrategies", "providerThinking"]) {
    const map = settings[key] as Record<string, unknown> | undefined;
    if (map && Object.hasOwn(map, oldId)) {
      const copy = { ...map };
      copy[newId] = copy[oldId];
      delete copy[oldId];
      settingsPatches[key] = copy;
    }
  }

  // Build updated node row payload
  const previousIds = Array.from(
    new Set([...(((current as Record<string, unknown>).previousIds as string[]) || []), oldId]),
  );
  const updatedNode: ProviderNode = {
    ...current,
    id: newId,
    previousIds: previousIds as string[],
    updatedAt: nowIso(),
  };
  const nodeExtras = splitExtras(updatedNode as unknown as Record<string, unknown>, NODE_COLS);

  const settingsStmt = db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");

  db().transaction(() => {
    // Note: provider_nodes.id is the PRIMARY KEY but there are no foreign
    // keys declared on dependent tables, so updating the row in place is
    // safe — we don't have to delete-then-insert.
    db()
      .prepare(
        `UPDATE provider_nodes
           SET id = ?, type = ?, name = ?, prefix = ?, api_type = ?, base_url = ?, data = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        newId,
        updatedNode.type || null,
        updatedNode.name ?? null,
        updatedNode.prefix ?? null,
        updatedNode.apiType ?? null,
        updatedNode.baseUrl ?? null,
        JSON.stringify(nodeExtras),
        updatedNode.updatedAt,
        oldId,
      );

    db().prepare("UPDATE provider_connections SET provider = ? WHERE provider = ?").run(newId, oldId);
    db().prepare("UPDATE custom_models SET provider_alias = ? WHERE provider_alias = ?").run(newId, oldId);
    db().prepare("UPDATE pricing SET provider = ? WHERE provider = ?").run(newId, oldId);
    db().prepare("UPDATE usage_history SET provider = ? WHERE provider = ?").run(newId, oldId);
    db().prepare("UPDATE request_details SET provider = ? WHERE provider = ?").run(newId, oldId);
    db().prepare("UPDATE request_log SET provider = ? WHERE provider = ?").run(newId, oldId);
    db().prepare("UPDATE daily_summary SET key = ? WHERE bucket = 'byProvider' AND key = ?").run(newId, oldId);

    const comboStmt = db().prepare("UPDATE combos SET data = ?, updated_at = ? WHERE id = ?");
    for (const u of comboUpdates) comboStmt.run(u.data, nowIso(), u.id);

    const aliasStmt = db().prepare("UPDATE model_aliases SET target = ? WHERE alias = ?");
    for (const u of aliasUpdates) aliasStmt.run(u.target, u.alias);

    for (const [k, v] of Object.entries(settingsPatches)) {
      settingsStmt.run(k, JSON.stringify(v));
    }
  })();

  return updatedNode;
}

// ===== Proxy Pools =======================================================

export async function getProxyPools(filter: ProxyPoolFilter = {}): Promise<ProxyPool[]> {
  if (isCloud) {
    const d = await getCloudDb();
    let list = d.data.proxyPools || [];
    if (filter.isActive !== undefined) list = list.filter((p) => p.isActive === filter.isActive);
    if (filter.testStatus) list = list.filter((p) => p.testStatus === filter.testStatus);
    return [...list].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.isActive !== undefined) {
    clauses.push("is_active = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(`SELECT * FROM proxy_pools ${where} ORDER BY updated_at DESC`)
    .all(...params) as ProxyPoolRow[];
  let result = rows.map(rowToPool);
  if (filter.testStatus) result = result.filter((p) => p.testStatus === filter.testStatus);
  return result;
}

export async function getProxyPoolById(id: string): Promise<ProxyPool | null> {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.proxyPools || []).find((p) => p.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM proxy_pools WHERE id = ?").get(id) as ProxyPoolRow | undefined;
  return r ? rowToPool(r) : null;
}

export async function createProxyPool(data: Record<string, unknown>): Promise<ProxyPool> {
  const now = nowIso();
  const pool: ProxyPool = {
    id: (data.id as string) || uuidv4(),
    name: data.name as string,
    proxyUrl: data.proxyUrl as string,
    noProxy: (data.noProxy as string) || "",
    type: (data.type as string) || "http",
    isActive: data.isActive !== undefined ? (data.isActive as boolean) : true,
    strictProxy: data.strictProxy === true,
    testStatus: (data.testStatus as string) || "unknown",
    lastTestedAt: (data.lastTestedAt as string) || null,
    lastError: (data.lastError as string) || null,
    createdAt: now,
    updatedAt: now,
  };
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.proxyPools) d.data.proxyPools = [];
    d.data.proxyPools.push(pool);
    return pool;
  }
  const extras = splitExtras(pool, POOL_COLS);
  db()
    .prepare(`
    INSERT INTO proxy_pools
    (id, name, proxy_url, type, is_active, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      pool.id,
      pool.name ?? null,
      pool.proxyUrl ?? null,
      pool.type,
      pool.isActive ? 1 : 0,
      JSON.stringify(extras),
      pool.createdAt,
      pool.updatedAt,
    );
  return pool;
}

export async function updateProxyPool(id: string, data: Record<string, unknown>): Promise<ProxyPool | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.proxyPools || []).findIndex((p) => p.id === id);
    if (idx === -1) return null;
    d.data.proxyPools[idx] = { ...d.data.proxyPools[idx], ...data, updatedAt: nowIso() } as ProxyPool;
    return d.data.proxyPools[idx];
  }
  const current = await getProxyPoolById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: nowIso() } as ProxyPool;
  const extras = splitExtras(merged, POOL_COLS);
  db()
    .prepare(`
    UPDATE proxy_pools
    SET name = ?, proxy_url = ?, type = ?, is_active = ?, data = ?, updated_at = ?
    WHERE id = ?
  `)
    .run(
      merged.name ?? null,
      merged.proxyUrl ?? null,
      (merged.type as string) || "http",
      merged.isActive === false ? 0 : 1,
      JSON.stringify(extras),
      merged.updatedAt,
      id,
    );
  return merged;
}

export async function deleteProxyPool(id: string): Promise<ProxyPool | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.proxyPools || []).findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const [removed] = d.data.proxyPools.splice(idx, 1);
    return removed ?? null;
  }
  const current = await getProxyPoolById(id);
  if (!current) return null;
  db().prepare("DELETE FROM proxy_pools WHERE id = ?").run(id);
  return current;
}

// ===== Model Aliases =====================================================

export async function getModelAliases(): Promise<Record<string, string>> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.modelAliases || {};
  }
  const rows = db().prepare("SELECT alias, target FROM model_aliases").all() as AliasRow[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.alias] = r.target;
  return out;
}

export async function setModelAlias(alias: string, model: string): Promise<void> {
  if (isCloud) {
    const d = await getCloudDb();
    d.data.modelAliases[alias] = model;
    return;
  }
  db().prepare("INSERT OR REPLACE INTO model_aliases (alias, target) VALUES (?, ?)").run(alias, model);
}

export async function deleteModelAlias(alias: string): Promise<void> {
  if (isCloud) {
    const d = await getCloudDb();
    delete d.data.modelAliases[alias];
    return;
  }
  db().prepare("DELETE FROM model_aliases WHERE alias = ?").run(alias);
}

// ===== Custom Models =====================================================

export async function getCustomModels(): Promise<CustomModel[]> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.customModels || [];
  }
  const rows = db().prepare("SELECT provider_alias, id, type, name FROM custom_models").all() as CustomModelRow[];
  return rows.map((r) => ({
    providerAlias: r.provider_alias,
    id: r.id,
    type: r.type || "llm",
    name: r.name || r.id,
  }));
}

export async function addCustomModel({
  providerAlias,
  id,
  type = "llm",
  name,
}: {
  providerAlias: string;
  id: string;
  type?: string;
  name?: string;
}): Promise<boolean> {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.customModels) d.data.customModels = [];
    const exists = d.data.customModels.some(
      (m) => m.providerAlias === providerAlias && m.id === id && (m.type || "llm") === type,
    );
    if (exists) return false;
    d.data.customModels.push({ providerAlias, id, type, name: name || id });
    return true;
  }
  const info = db()
    .prepare("INSERT OR IGNORE INTO custom_models (provider_alias, id, type, name) VALUES (?, ?, ?, ?)")
    .run(providerAlias, id, type, name || id) as { changes: number };
  return info.changes > 0;
}

export async function deleteCustomModel({
  providerAlias,
  id,
  type = "llm",
}: {
  providerAlias: string;
  id: string;
  type?: string;
}): Promise<void> {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.customModels) return;
    d.data.customModels = d.data.customModels.filter(
      (m) => !(m.providerAlias === providerAlias && m.id === id && (m.type || "llm") === type),
    );
    return;
  }
  db()
    .prepare("DELETE FROM custom_models WHERE provider_alias = ? AND id = ? AND type = ?")
    .run(providerAlias, id, type);
}

// ===== Combos ============================================================

export async function getCombos(): Promise<Combo[]> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.combos || [];
  }
  const rows = db().prepare("SELECT * FROM combos ORDER BY COALESCE(sort_order, rowid)").all() as ComboRow[];
  return rows.map(rowToCombo);
}

export async function getComboById(id: string): Promise<Combo | null> {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.combos || []).find((c) => c.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM combos WHERE id = ?").get(id) as ComboRow | undefined;
  return r ? rowToCombo(r) : null;
}

export async function getComboByName(name: string): Promise<Combo | null> {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.combos || []).find((c) => c.name === name) || null;
  }
  const r = db().prepare("SELECT * FROM combos WHERE name = ?").get(name) as ComboRow | undefined;
  return r ? rowToCombo(r) : null;
}

export async function createCombo(data: Record<string, unknown>): Promise<Combo> {
  const now = nowIso();
  const combo: Combo = {
    id: uuidv4(),
    name: data.name as string,
    models: (data.models as string[]) || [],
    kind: (data.kind as string) || null,
    systemPrompt: (data.systemPrompt as string) || null,
    modelId: (data.modelId as string) || null,
    contentFilterMessage: (data.contentFilterMessage as string) || null,
    createdAt: now,
    updatedAt: now,
  };
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.combos) d.data.combos = [];
    d.data.combos.push(combo);
    return combo;
  }
  const extras = splitExtras(combo, COMBO_COLS);
  db()
    .prepare(`
    INSERT INTO combos (id, name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
    .run(combo.id, combo.name ?? null, JSON.stringify(extras), combo.createdAt, combo.updatedAt);
  return combo;
}

export async function updateCombo(id: string, data: Record<string, unknown>): Promise<Combo | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.combos || []).findIndex((c) => c.id === id);
    if (idx === -1) return null;
    d.data.combos[idx] = { ...d.data.combos[idx], ...data, updatedAt: nowIso() } as Combo;
    return d.data.combos[idx];
  }
  const current = await getComboById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: nowIso() } as Combo;
  const extras = splitExtras(merged, COMBO_COLS);
  db()
    .prepare(`
    UPDATE combos SET name = ?, data = ?, updated_at = ? WHERE id = ?
  `)
    .run(merged.name ?? null, JSON.stringify(extras), merged.updatedAt, id);
  return merged;
}

export async function deleteCombo(id: string): Promise<boolean> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.combos || []).findIndex((c) => c.id === id);
    if (idx === -1) return false;
    d.data.combos.splice(idx, 1);
    return true;
  }
  const r = db().prepare("DELETE FROM combos WHERE id = ?").run(id) as { changes: number };
  return r.changes > 0;
}

export async function reorderCombos(orderedIds: string[]): Promise<boolean> {
  if (isCloud) {
    const d = await getCloudDb();
    const map = new Map((d.data.combos || []).map((c) => [c.id, c]));
    d.data.combos = orderedIds.map((id, i) => ({ ...(map.get(id) as Combo), sortOrder: i })).filter(Boolean) as Combo[];
    return true;
  }
  const stmt = db().prepare("UPDATE combos SET sort_order = ? WHERE id = ?");
  const update = db().transaction((ids: string[]) => {
    for (let i = 0; i < ids.length; i++) {
      stmt.run(i, ids[i]);
    }
  });
  update(orderedIds);
  return true;
}

// ===== API Keys ==========================================================

export async function getApiKeys(): Promise<ApiKey[]> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.apiKeys || [];
  }
  const rows = db().prepare("SELECT * FROM api_keys").all() as ApiKeyRow[];
  return rows.map(rowToApiKey);
}

export async function createApiKey(
  name: string,
  machineId: string,
  options: Record<string, unknown> = {},
): Promise<ApiKey> {
  if (!machineId) throw new Error("machineId is required");
  const now = nowIso();
  const { generateApiKeyWithMachine } = (await import("@/shared/utils/apiKey")) as {
    generateApiKeyWithMachine: (machineId: string) => { key: string };
  };
  const result = generateApiKeyWithMachine(machineId);
  const limits = normalizeApiKeyRateLimitInput(options);
  const apiKey: ApiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: now,
    lastAccessAt: null,
    limitType: limits.limitType,
    requestsPerMinute: limits.requestsPerMinute,
    concurrentRequests: limits.concurrentRequests,
  };
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.apiKeys) d.data.apiKeys = [];
    d.data.apiKeys.push(apiKey);
    return apiKey;
  }
  db()
    .prepare(`
    INSERT INTO api_keys
    (id, name, key, machine_id, is_active, created_at, limit_type, requests_per_minute, concurrent_requests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .run(
      apiKey.id,
      apiKey.name,
      apiKey.key,
      apiKey.machineId,
      1,
      apiKey.createdAt,
      apiKey.limitType,
      apiKey.requestsPerMinute,
      apiKey.concurrentRequests,
    );
  return apiKey;
}

export async function deleteApiKey(id: string): Promise<boolean> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.apiKeys || []).findIndex((k) => k.id === id);
    if (idx === -1) return false;
    d.data.apiKeys.splice(idx, 1);
    return true;
  }
  const r = db().prepare("DELETE FROM api_keys WHERE id = ?").run(id) as { changes: number };
  return r.changes > 0;
}

export async function getApiKeyById(id: string): Promise<ApiKey | null> {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.apiKeys || []).find((k) => k.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | undefined;
  return r ? rowToApiKey(r) : null;
}

export async function updateApiKey(id: string, data: Record<string, unknown>): Promise<ApiKey | null> {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.apiKeys || []).findIndex((k) => k.id === id);
    if (idx === -1) return null;
    const current = d.data.apiKeys[idx];
    const merged = {
      ...current,
      ...data,
      ...normalizeApiKeyRateLimitInput(data, current as unknown as Record<string, unknown>),
    };
    d.data.apiKeys[idx] = merged as ApiKey;
    return d.data.apiKeys[idx];
  }
  const current = await getApiKeyById(id);
  if (!current) return null;
  const limits = normalizeApiKeyRateLimitInput(data, current as unknown as Record<string, unknown>);
  const merged = {
    ...current,
    ...data,
    ...limits,
  };
  db()
    .prepare(`
    UPDATE api_keys
    SET name = ?, key = ?, machine_id = ?, is_active = ?,
        limit_type = ?, requests_per_minute = ?, concurrent_requests = ?
    WHERE id = ?
  `)
    .run(
      (merged.name as string) ?? null,
      merged.key,
      merged.machineId ?? null,
      merged.isActive === false ? 0 : 1,
      merged.limitType,
      merged.requestsPerMinute,
      merged.concurrentRequests,
      id,
    );
  return merged as ApiKey;
}

/**
 * Compare two strings in constant time to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) {
      // Still run timingSafeEqual on equal-length buffers to avoid short-circuit,
      // then return false so length difference doesn't leak via timing.
      timingSafeEqual(aBuf, aBuf);
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export async function validateApiKey(key: string): Promise<boolean> {
  if (!key) return false;
  if (isCloud) {
    const d = await getCloudDb();
    const activeKeys = (d.data.apiKeys || []).filter((k) => k.isActive !== false);
    // Use safeCompare against every active key to avoid timing leaks
    let found = false;
    for (const k of activeKeys) {
      if (safeCompare(k.key, key)) found = true;
    }
    return found;
  }
  // Fetch the stored key by a non-secret lookup (id/active), then compare in constant time
  const r = db().prepare("SELECT key FROM api_keys WHERE is_active != 0").all() as { key: string }[];
  let found = false;
  for (const row of r) {
    if (safeCompare(row.key, key)) found = true;
  }
  return found;
}

export async function getApiKeyByKey(key: string): Promise<ApiKey | null> {
  if (!key) return null;
  if (isCloud) {
    const d = await getCloudDb();
    const found = (d.data.apiKeys || []).find((k) => k.key === key && k.isActive !== false) || null;
    if (found) found.lastAccessAt = nowIso();
    return found;
  }
  const r = db().prepare("SELECT * FROM api_keys WHERE key = ? AND is_active != 0 LIMIT 1").get(key) as
    | ApiKeyRow
    | undefined;
  if (!r) return null;
  const now = nowIso();
  db().prepare("UPDATE api_keys SET last_access_at = ? WHERE id = ?").run(now, r.id);
  return rowToApiKey({ ...r, last_access_at: now });
}

// ===== Settings ==========================================================

export async function getSettings(): Promise<Settings> {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.settings as Settings) || ({ cloudEnabled: false } as Settings);
  }
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out = { ...DEFAULT_SETTINGS } as Settings;
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value) as unknown;
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

export async function updateSettings(updates: Record<string, unknown>): Promise<Settings> {
  if (isCloud) {
    const d = await getCloudDb();
    d.data.settings = { ...d.data.settings, ...updates };
    return d.data.settings as Settings;
  }
  const stmt = db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const runAll = db().transaction((patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) {
      stmt.run(k, JSON.stringify(v));
    }
  });
  runAll(updates);
  return await getSettings();
}

// ===== Cleanup / Export / Import =========================================

export async function cleanupProviderConnections(): Promise<number> {
  const fieldsToCheck = [
    "displayName",
    "email",
    "globalPriority",
    "defaultModel",
    "accessToken",
    "refreshToken",
    "expiresAt",
    "tokenType",
    "scope",
    "projectId",
    "apiKey",
    "testStatus",
    "lastTested",
    "lastError",
    "lastErrorAt",
    "rateLimitedUntil",
    "expiresIn",
    "consecutiveUseCount",
  ];

  const all = await getProviderConnections();
  let cleaned = 0;
  for (const conn of all) {
    let dirty = false;
    for (const f of fieldsToCheck) {
      if (conn[f] === null || conn[f] === undefined) {
        delete conn[f];
        dirty = true;
        cleaned++;
      }
    }
    if (conn.providerSpecificData && Object.keys(conn.providerSpecificData as Record<string, unknown>).length === 0) {
      delete conn.providerSpecificData;
      dirty = true;
      cleaned++;
    }
    if (dirty) {
      // Re-write the row with the cleaned JSON blob.
      const extras = splitExtras(conn as unknown as Record<string, unknown>, CONN_COLS);
      if (isCloud) continue;
      db()
        .prepare("UPDATE provider_connections SET data = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(extras), nowIso(), conn.id);
    }
  }
  return cleaned;
}

export async function exportDb(): Promise<CloudData> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data || cloneDefaultData();
  }
  return {
    providerConnections: await getProviderConnections(),
    providerNodes: await getProviderNodes(),
    proxyPools: await getProxyPools(),
    modelAliases: await getModelAliases(),
    combos: await getCombos(),
    apiKeys: await getApiKeys(),
    customModels: await getCustomModels(),
    settings: (await getSettings()) as Record<string, unknown>,
    pricing: await getRawPricing(),
  };
}

export async function importDb(payload: Record<string, unknown>): Promise<CloudData> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }

  const next = {
    ...cloneDefaultData(),
    ...payload,
    settings: {
      ...cloneDefaultData().settings,
      ...(payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings)
        ? (payload.settings as Record<string, unknown>)
        : {}),
    },
  } as CloudData;

  if (isCloud) {
    const d = await getCloudDb();
    d.data = next;
    return d.data;
  }

  // Wipe + bulk insert everything inside one transaction so the dashboard
  // either sees the full previous state or the full new state.
  const run = db().transaction((data: CloudData) => {
    db().exec(`
      DELETE FROM provider_connections;
      DELETE FROM provider_nodes;
      DELETE FROM proxy_pools;
      DELETE FROM combos;
      DELETE FROM api_keys;
      DELETE FROM model_aliases;
      DELETE FROM custom_models;
      DELETE FROM settings;
      DELETE FROM pricing;
    `);

    const connStmt = db().prepare(`
      INSERT INTO provider_connections
      (id, provider, auth_type, name, priority, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of data.providerConnections || []) {
      const extras = splitExtras(c as unknown as Record<string, unknown>, CONN_COLS);
      connStmt.run(
        c.id || uuidv4(),
        c.provider,
        c.authType || null,
        c.name ?? null,
        c.priority ?? null,
        c.isActive === false ? 0 : 1,
        JSON.stringify(extras),
        c.createdAt || nowIso(),
        c.updatedAt || nowIso(),
      );
    }

    const nodeStmt = db().prepare(`
      INSERT INTO provider_nodes
      (id, type, name, prefix, api_type, base_url, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of data.providerNodes || []) {
      const extras = splitExtras(n as unknown as Record<string, unknown>, NODE_COLS);
      nodeStmt.run(
        n.id || uuidv4(),
        n.type || null,
        n.name ?? null,
        n.prefix ?? null,
        n.apiType ?? null,
        n.baseUrl ?? null,
        JSON.stringify(extras),
        n.createdAt || nowIso(),
        n.updatedAt || nowIso(),
      );
    }

    const poolStmt = db().prepare(`
      INSERT INTO proxy_pools
      (id, name, proxy_url, type, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data.proxyPools || []) {
      const extras = splitExtras(p as unknown as Record<string, unknown>, POOL_COLS);
      poolStmt.run(
        p.id || uuidv4(),
        p.name ?? null,
        p.proxyUrl ?? null,
        (p.type as string) || "http",
        p.isActive === false ? 0 : 1,
        JSON.stringify(extras),
        p.createdAt || nowIso(),
        p.updatedAt || nowIso(),
      );
    }

    const comboStmt = db().prepare(`
      INSERT INTO combos (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const c of data.combos || []) {
      const extras = splitExtras(c as unknown as Record<string, unknown>, COMBO_COLS);
      comboStmt.run(
        c.id || uuidv4(),
        c.name ?? null,
        JSON.stringify(extras),
        c.createdAt || nowIso(),
        c.updatedAt || nowIso(),
      );
    }

    const apiKeyStmt = db().prepare(`
      INSERT INTO api_keys
      (id, name, key, machine_id, is_active, created_at, limit_type, requests_per_minute, concurrent_requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const k of data.apiKeys || []) {
      if (!k.key) continue;
      const limits = normalizeApiKeyRateLimitInput(k as unknown as Record<string, unknown>);
      apiKeyStmt.run(
        k.id || uuidv4(),
        k.name ?? null,
        k.key,
        k.machineId ?? null,
        k.isActive === false ? 0 : 1,
        k.createdAt || nowIso(),
        limits.limitType,
        limits.requestsPerMinute,
        limits.concurrentRequests,
      );
    }

    const aliasStmt = db().prepare("INSERT INTO model_aliases (alias, target) VALUES (?, ?)");
    for (const [a, t] of Object.entries(data.modelAliases || {})) {
      if (typeof t === "string") aliasStmt.run(a, t);
    }

    const customModelStmt = db().prepare(
      "INSERT OR IGNORE INTO custom_models (provider_alias, id, type, name) VALUES (?, ?, ?, ?)",
    );
    for (const m of data.customModels || []) {
      if (!m?.providerAlias || !m?.id) continue;
      customModelStmt.run(m.providerAlias, m.id, m.type || "llm", m.name || m.id);
    }

    const settingsStmt = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(data.settings || {})) {
      settingsStmt.run(k, JSON.stringify(v));
    }

    const priceStmt = db().prepare("INSERT INTO pricing (provider, model, data) VALUES (?, ?, ?)");
    for (const [provider, models] of Object.entries(data.pricing || {})) {
      if (!models || typeof models !== "object") continue;
      for (const [model, p] of Object.entries(models as Record<string, unknown>)) {
        priceStmt.run(provider, model, JSON.stringify(p ?? {}));
      }
    }
  });
  run(next);
  return next;
}

export async function isCloudEnabled(): Promise<boolean> {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl(): Promise<string> {
  const settings = await getSettings();
  return (settings.cloudUrl as string) || process.env.CLOUD_URL || process.env.NEXT_PUBLIC_CLOUD_URL || "";
}

// ===== Pricing ===========================================================

async function getRawPricing(): Promise<Record<string, Record<string, unknown>>> {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.pricing || {};
  }
  const rows = db().prepare("SELECT provider, model, data FROM pricing").all() as PricingRow[];
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    if (!out[r.provider]) out[r.provider] = {};
    out[r.provider]![r.model] = parseExtras(r.data);
  }
  return out;
}

export async function getPricing(): Promise<Record<string, Record<string, unknown>>> {
  const userPricing = await getRawPricing();
  const { PROVIDER_PRICING } = (await import("@/shared/constants/pricing")) as {
    PROVIDER_PRICING: Record<string, Record<string, unknown>>;
  };

  const merged: Record<string, Record<string, unknown>> = {};
  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
    merged[provider] = { ...models };
    if (userPricing[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        merged[provider][model] = merged[provider][model]
          ? { ...(merged[provider][model] as Record<string, unknown>), ...(pricing as Record<string, unknown>) }
          : (pricing as Record<string, unknown>);
      }
    }
  }
  for (const [provider, models] of Object.entries(userPricing)) {
    if (!merged[provider]) {
      merged[provider] = { ...(models as Record<string, unknown>) };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        if (!merged[provider][model]) merged[provider][model] = pricing as Record<string, unknown>;
      }
    }
  }
  return merged;
}

export async function getPricingForModel(provider: string, model: string): Promise<Record<string, unknown> | null> {
  if (!model) return null;

  if (isCloud) {
    const d = await getCloudDb();
    const userPricing = d.data.pricing || {};
    if (provider && userPricing[provider]?.[model]) return userPricing[provider][model] as Record<string, unknown>;
  } else {
    if (provider) {
      const r = db().prepare("SELECT data FROM pricing WHERE provider = ? AND model = ?").get(provider, model) as
        | PricingRow
        | undefined;
      if (r) return parseExtras(r.data);
    }
  }

  // Check models.dev synced pricing
  const { getModelsDevPricingForModel } = (await import("@/lib/modelsDevSync")) as {
    getModelsDevPricingForModel: (provider: string, model: string) => Record<string, unknown> | null;
  };
  const mdPricing = getModelsDevPricingForModel(provider, model);
  if (mdPricing) return mdPricing;

  const { getPricingForModel: resolve } = (await import("@/shared/constants/pricing")) as {
    getPricingForModel: (provider: string, model: string) => Record<string, unknown> | null;
  };
  return resolve(provider, model);
}

export async function updatePricing(
  pricingData: Record<string, Record<string, unknown>>,
): Promise<Record<string, Record<string, unknown>>> {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.pricing) d.data.pricing = {};
    for (const [provider, models] of Object.entries(pricingData)) {
      if (!d.data.pricing[provider]) d.data.pricing[provider] = {};
      for (const [model, p] of Object.entries(models)) {
        d.data.pricing[provider][model] = p;
      }
    }
    return d.data.pricing;
  }
  const stmt = db().prepare("INSERT OR REPLACE INTO pricing (provider, model, data) VALUES (?, ?, ?)");
  const run = db().transaction((patch: Record<string, Record<string, unknown>>) => {
    for (const [provider, models] of Object.entries(patch)) {
      for (const [model, p] of Object.entries(models)) {
        stmt.run(provider, model, JSON.stringify(p));
      }
    }
  });
  run(pricingData);
  return await getRawPricing();
}

export async function resetPricing(provider: string, model?: string): Promise<Record<string, Record<string, unknown>>> {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.pricing) d.data.pricing = {};
    if (model) {
      if (d.data.pricing[provider]) {
        delete d.data.pricing[provider][model];
        if (Object.keys(d.data.pricing[provider]).length === 0) {
          delete d.data.pricing[provider];
        }
      }
    } else {
      delete d.data.pricing[provider];
    }
    return d.data.pricing;
  }
  if (model) {
    db().prepare("DELETE FROM pricing WHERE provider = ? AND model = ?").run(provider, model);
  } else {
    db().prepare("DELETE FROM pricing WHERE provider = ?").run(provider);
  }
  return await getRawPricing();
}

export async function resetAllPricing(): Promise<Record<string, Record<string, unknown>>> {
  if (isCloud) {
    const d = await getCloudDb();
    d.data.pricing = {};
    return d.data.pricing;
  }
  db().prepare("DELETE FROM pricing").run();
  return {};
}
