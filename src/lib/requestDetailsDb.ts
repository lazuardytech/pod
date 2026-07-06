// Request-details (full request/response trace) facade. SQLite-backed on
// Node; no-op on Workers. Preserves the existing batched-write pattern:
// callers push into an in-memory buffer and a single transactional INSERT
// runs on batch threshold or after a debounce timer.

import { closeDatabase, getDatabase } from "@/lib/sqlite/connection";
import { error as logError } from "@/sse/utils/logger";

const isCloud = typeof caches !== "undefined" || typeof caches === "object";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;
const WRITE_BUFFER_MAX = 500; // hard cap — prevent unbounded growth if flush stalls

type ObservabilityConfig = {
  enabled: boolean;
  maxRecords: number;
  batchSize: number;
  flushIntervalMs: number;
  maxJsonSize: number;
};

let cachedConfig: ObservabilityConfig | null = null;
let cachedConfigTs = 0;

async function getObservabilityConfig(): Promise<ObservabilityConfig> {
  if (cachedConfig && Date.now() - cachedConfigTs < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }
  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled =
      typeof settings.enableObservability === "boolean"
        ? settings.enableObservability
        : typeof settings.observabilityEnabled === "boolean"
          ? settings.observabilityEnabled
          : envEnabled;
    cachedConfig = {
      enabled,
      maxRecords:
        settings.observabilityMaxRecords ||
        parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize:
        settings.observabilityBatchSize ||
        parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs:
        settings.observabilityFlushIntervalMs ||
        parseInt(
          process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS),
          10,
        ),
      maxJsonSize:
        (settings.observabilityMaxJsonSize ||
          parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

type DetailItem = {
  id?: string;
  timestamp?: string;
  provider?: string | null;
  model?: string | null;
  connectionId?: string | null;
  status?: string | null;
  latency?: number | { total?: number; totalMs?: number } | null;
  tokens?: {
    prompt_tokens?: number;
    input_tokens?: number;
    completion_tokens?: number;
    output_tokens?: number;
  } | null;
  request?: { headers?: Record<string, unknown> } & Record<string, unknown>;
  providerRequest?: Record<string, unknown>;
  providerResponse?: Record<string, unknown>;
  response?: Record<string, unknown>;
};

let writeBuffer: DetailItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

function sanitizeHeaders(
  headers: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized: Record<string, unknown> = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

function generateDetailId(model?: string | null): string {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

export { generateDetailId };

function truncateIfLarge(obj: unknown, maxSize: number): unknown {
  const str = JSON.stringify(obj);
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj;
}

// Returns a flat { id, ts, provider, ... latency_ms, prompt, completion, dataBlob } row.
function prepareRecord(
  item: DetailItem,
  maxSize: number,
): {
  id: string;
  timestamp: string;
  provider: string | null;
  model: string | null;
  connectionId: string | null;
  status: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  data: string;
} {
  if (!item.id) item.id = generateDetailId(item.model);
  if (!item.timestamp) item.timestamp = new Date().toISOString();
  if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers) as never;

  const payload = {
    latency: item.latency || {},
    tokens: item.tokens || {},
    request: truncateIfLarge(item.request || {}, maxSize),
    providerRequest: truncateIfLarge(item.providerRequest || {}, maxSize),
    providerResponse: truncateIfLarge(item.providerResponse || {}, maxSize),
    response: truncateIfLarge(item.response || {}, maxSize),
  };

  const latency =
    typeof item.latency === "number"
      ? item.latency
      : (item.latency?.total ?? item.latency?.totalMs ?? null);
  const t = item.tokens || {};
  return {
    id: item.id,
    timestamp: item.timestamp,
    provider: item.provider || null,
    model: item.model || null,
    connectionId: item.connectionId || null,
    status: item.status || null,
    latency_ms: latency,
    prompt_tokens: t.prompt_tokens ?? t.input_tokens ?? null,
    completion_tokens: t.completion_tokens ?? t.output_tokens ?? null,
    data: JSON.stringify(payload),
  };
}

async function flushToDatabase(): Promise<void> {
  if (isCloud || isFlushing || writeBuffer.length === 0) return;
  isFlushing = true;
  // Resolve config + db BEFORE draining the buffer so items are not lost
  // if either call throws (previously the buffer was drained first).
  let items: DetailItem[];
  try {
    const config = await getObservabilityConfig();
    const db = getDatabase();
    items = writeBuffer;
    writeBuffer = [];

    const insert = db.prepare(`
      INSERT OR REPLACE INTO request_details
      (id, timestamp, provider, model, connection_id, status, latency_ms,
       prompt_tokens, completion_tokens, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const run = db.transaction(() => {
      for (const item of items) {
        const r = prepareRecord(item, config.maxJsonSize);
        insert.run(
          r.id,
          r.timestamp,
          r.provider,
          r.model,
          r.connectionId,
          r.status,
          r.latency_ms,
          r.prompt_tokens,
          r.completion_tokens,
          r.data,
        );
      }
      // Trim to maxRecords (keep newest).
      db.prepare(`
        DELETE FROM request_details
        WHERE id IN (
          SELECT id FROM request_details
          ORDER BY timestamp DESC
          LIMIT -1 OFFSET ?
        )
      `).run(config.maxRecords);
    });
    run();
  } catch (err) {
    logError("requestDetailsDb", "Batch write failed", { error: (err as Error).message });
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail: DetailItem): Promise<void> {
  if (isCloud) return;
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  // Hard cap: drop oldest entries if buffer grows too large (flush stall guard)
  if (writeBuffer.length > WRITE_BUFFER_MAX) {
    writeBuffer = writeBuffer.slice(-WRITE_BUFFER_MAX);
  }

  if (writeBuffer.length >= config.batchSize) {
    await flushToDatabase();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushToDatabase().catch(() => {});
      flushTimer = null;
    }, config.flushIntervalMs);
  }
}

type DetailRow = {
  id: string;
  timestamp: string;
  provider: string | null;
  model: string | null;
  connection_id: string | null;
  status: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  data: string;
};

function rowToDetail(r: DetailRow): DetailItem {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.data || "{}") as Record<string, unknown>;
  } catch {}
  return {
    id: r.id,
    timestamp: r.timestamp,
    provider: r.provider,
    model: r.model,
    connectionId: r.connection_id,
    status: r.status,
    latency:
      (payload.latency as number | { total?: number; totalMs?: number } | undefined) ??
      (r.latency_ms != null ? { total: r.latency_ms } : {}),
    tokens:
      (payload.tokens as DetailItem["tokens"]) ??
      ({
        prompt_tokens: r.prompt_tokens ?? undefined,
        completion_tokens: r.completion_tokens ?? undefined,
      } as DetailItem["tokens"]),
    request: (payload.request as DetailItem["request"]) ?? {},
    providerRequest: (payload.providerRequest as DetailItem["providerRequest"]) ?? {},
    providerResponse: (payload.providerResponse as DetailItem["providerResponse"]) ?? {},
    response: (payload.response as DetailItem["response"]) ?? {},
  };
}

export type GetRequestDetailsFilter = {
  provider?: string;
  model?: string;
  connectionId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
};

export type RequestDetailsPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type GetRequestDetailsResult = {
  details: DetailItem[];
  pagination: RequestDetailsPagination;
};

export async function getRequestDetails(
  filter: GetRequestDetailsFilter = {},
): Promise<GetRequestDetailsResult> {
  if (isCloud) {
    return {
      details: [],
      pagination: {
        page: 1,
        pageSize: 50,
        totalItems: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
  }
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
  if (filter.connectionId) {
    clauses.push("connection_id = ?");
    params.push(filter.connectionId);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
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

  const countRow = db
    .prepare(`SELECT COUNT(*) AS c FROM request_details ${where}`)
    .get(...params) as { c?: number } | undefined;
  const totalItems = countRow?.c || 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);

  const rows = db
    .prepare(`
    SELECT * FROM request_details ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `)
    .all(...params, pageSize, (page - 1) * pageSize) as DetailRow[];

  return {
    details: rows.map(rowToDetail),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

export async function getRequestDetailById(id: string): Promise<DetailItem | null> {
  if (isCloud) return null;
  const db = getDatabase();
  const r = db.prepare("SELECT * FROM request_details WHERE id = ?").get(id) as
    | DetailRow
    | undefined;
  return r ? rowToDetail(r) : null;
}

// Graceful shutdown — flush pending buffer before exit.
const _shutdownHandler = async (): Promise<void> => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (writeBuffer.length > 0) await flushToDatabase();
  try {
    closeDatabase();
  } catch {
    /* best effort during shutdown */
  }
};

function ensureShutdownHandler(): void {
  if (isCloud) return;
  const previous = globalThis.__podRequestDetailsShutdownHandler;
  if (previous) {
    process.off("beforeExit", previous);
    process.off("SIGINT", previous);
    process.off("SIGTERM", previous);
    process.off("exit", previous);
  }
  globalThis.__podRequestDetailsShutdownHandler = _shutdownHandler;
  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
  process.on("exit", _shutdownHandler);
}

ensureShutdownHandler();
