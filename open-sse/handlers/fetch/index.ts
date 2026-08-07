// Web Fetch handler — dispatches to firecrawl, jina-reader, tavily, exa
// Returns normalized shape across all providers

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_FORMAT = "markdown";

export type FetchResult =
  | { success: true; data: unknown; response?: Response }
  | { success: false; status: number; error: string };

type JsonRecord = Record<string, unknown>;

type FetchCredentials = JsonRecord & {
  apiKey?: string;
  key?: string;
  token?: string;
};

type FetchProviderConfig = JsonRecord & {
  timeoutMs?: number;
  costPerQuery?: number | null;
};

export interface FetchCoreParams {
  url: string;
  format?: string;
  maxCharacters?: number;
  provider: string;
  providerConfig: FetchProviderConfig | null;
  credentials: FetchCredentials | null;
  log?: unknown;
  onCredentialsRefreshed?: (newCreds: JsonRecord) => Promise<void> | void;
  onRequestSuccess?: () => Promise<void> | void;
}

type ProviderRunParams = {
  url: string;
  fmt: string;
  timeoutMs: number;
  apiKey: string;
  maxCharacters?: number;
  costPerQuery: number | null;
  startedAt: number;
};

type BuildDataParams = {
  provider: string;
  url: string;
  title: string | null;
  format: string;
  text: string;
  costUsd: number | null;
  responseMs: number;
  upstreamMs: number;
};

type TryFetchOk = { ok: true; res: Response };
type TryFetchErr = { ok: false; timeout: boolean; error: string };
type TryFetchResult = TryFetchOk | TryFetchErr;

type ReadJsonResult = { json?: JsonRecord; text?: string };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Strip non-ASCII chars from header values (HTTP headers must be ByteString).
function stripNonAscii(text: string) {
  let clean = "";
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 255) clean += text[i] ?? "";
  }
  return clean;
}

function sanitizeHeaders(headers: unknown) {
  if (!headers) return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? stripNonAscii(v).trim() : v;
  }
  return out;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function callLog(log: unknown, ...args: unknown[]) {
  if (typeof log === "function") {
    (log as (...a: unknown[]) => void)(...args);
  }
}

async function tryFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<TryFetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: sanitizeHeaders(init.headers) as HeadersInit,
      signal: ctrl.signal,
    });
    return { ok: true, res };
  } catch (err: unknown) {
    const isAbort = isAbortError(err);
    return { ok: false, timeout: isAbort, error: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

function truncate(text: unknown, max?: number): string {
  if (!text || typeof text !== "string") return (text as string) || "";
  if (!max || max <= 0) return text;
  return text.length > max ? text.slice(0, max) : text;
}

function parseJinaTitle(text: unknown): string | null {
  const m = String(text || "").match(/^\s*#\s+(.+)$/m);
  const title = m?.[1];
  return title ? title.trim() : null;
}

function buildData({
  provider,
  url,
  title,
  format,
  text,
  costUsd,
  responseMs,
  upstreamMs,
}: BuildDataParams) {
  return {
    provider,
    url,
    title: title || null,
    content: { format, text: text || "", length: (text || "").length },
    metadata: { author: null, published_at: null, language: null },
    usage: { fetch_cost_usd: costUsd ?? null },
    metrics: { response_time_ms: responseMs, upstream_latency_ms: upstreamMs },
  };
}

async function readJsonOrText(res: Response): Promise<ReadJsonResult> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return { json: (await res.json()) as JsonRecord };
    } catch {
      // Treat malformed provider JSON as an empty text fallback.
      return { text: "" };
    }
  }
  return { text: await res.text() };
}

/**
 * Main handler.
 */
export async function handleFetchCore({
  url,
  format,
  maxCharacters,
  provider,
  providerConfig,
  credentials,
  log,
}: FetchCoreParams): Promise<FetchResult> {
  if (!url || typeof url !== "string") {
    return { success: false, status: 400, error: "url is required" };
  }
  if (!provider) {
    return { success: false, status: 400, error: "provider is required" };
  }

  const fmt = format || DEFAULT_FORMAT;
  const timeoutMs =
    typeof providerConfig?.timeoutMs === "number" ? providerConfig.timeoutMs : DEFAULT_TIMEOUT_MS;
  const apiKey = String(credentials?.apiKey || credentials?.key || credentials?.token || "");
  const costPerQuery =
    providerConfig?.costPerQuery === undefined ? null : (providerConfig.costPerQuery ?? null);
  const startedAt = Date.now();

  try {
    if (provider === "firecrawl") {
      return await runFirecrawl({
        url,
        fmt,
        timeoutMs,
        apiKey,
        maxCharacters,
        costPerQuery,
        startedAt,
      });
    }
    if (provider === "jina-reader") {
      return await runJina({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    if (provider === "tavily") {
      return await runTavily({
        url,
        fmt,
        timeoutMs,
        apiKey,
        maxCharacters,
        costPerQuery,
        startedAt,
      });
    }
    if (provider === "exa") {
      return await runExa({ url, fmt, timeoutMs, apiKey, maxCharacters, costPerQuery, startedAt });
    }
    return { success: false, status: 400, error: `Unsupported provider: ${provider}` };
  } catch (err: unknown) {
    callLog(log, "fetch handler error:", errorMessage(err));
    return { success: false, status: 502, error: errorMessage(err) || "Internal fetch error" };
  }
}

async function runFirecrawl({
  url,
  fmt,
  timeoutMs,
  apiKey,
  maxCharacters,
  costPerQuery,
  startedAt,
}: ProviderRunParams): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch(
    "https://api.firecrawl.dev/v1/scrape",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ url, formats: [fmt] }),
    },
    timeoutMs,
  );

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return {
      success: false,
      status: r.res.status,
      error:
        (typeof json?.error === "string" ? json.error : null) || `Firecrawl error: ${r.res.status}`,
    };
  }
  const d = (isRecord(json?.data) ? json.data : {}) as JsonRecord & {
    markdown?: string;
    html?: string;
    text?: string;
    metadata?: { title?: string };
  };
  const text = truncate(d.markdown || d.html || d.text || "", maxCharacters);
  const title = d.metadata?.title || null;
  return {
    success: true,
    data: buildData({
      provider: "firecrawl",
      url,
      title,
      format: fmt,
      text,
      costUsd: costPerQuery,
      responseMs: Date.now() - startedAt,
      upstreamMs,
    }),
  };
}

async function runJina({
  url,
  fmt,
  timeoutMs,
  apiKey,
  maxCharacters,
  costPerQuery,
  startedAt,
}: ProviderRunParams): Promise<FetchResult> {
  const target = `https://r.jina.ai/${encodeURIComponent(url)}`;
  const upstreamStart = Date.now();
  const r = await tryFetch(
    target,
    {
      method: "GET",
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    },
    timeoutMs,
  );

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const body = await r.res.text();
  if (!r.res.ok) {
    return {
      success: false,
      status: r.res.status,
      error: body?.slice(0, 500) || `Jina error: ${r.res.status}`,
    };
  }
  const text = truncate(body, maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "jina-reader",
      url,
      title: parseJinaTitle(body),
      format: fmt,
      text,
      costUsd: costPerQuery,
      responseMs: Date.now() - startedAt,
      upstreamMs,
    }),
  };
}

async function runTavily({
  url,
  fmt,
  timeoutMs,
  apiKey,
  maxCharacters,
  costPerQuery,
  startedAt,
}: ProviderRunParams): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch(
    "https://api.tavily.com/extract",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ urls: [url], extract_depth: "basic" }),
    },
    timeoutMs,
  );

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return {
      success: false,
      status: r.res.status,
      error:
        (typeof json?.error === "string" ? json.error : null) || `Tavily error: ${r.res.status}`,
    };
  }
  const results = Array.isArray(json?.results) ? json.results : [];
  const first = (isRecord(results[0]) ? results[0] : {}) as JsonRecord & { raw_content?: string };
  const text = truncate(first.raw_content || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "tavily",
      url,
      title: null,
      format: fmt,
      text,
      costUsd: costPerQuery,
      responseMs: Date.now() - startedAt,
      upstreamMs,
    }),
  };
}

async function runExa({
  url,
  fmt,
  timeoutMs,
  apiKey,
  maxCharacters,
  costPerQuery,
  startedAt,
}: ProviderRunParams): Promise<FetchResult> {
  const upstreamStart = Date.now();
  const r = await tryFetch(
    "https://api.exa.ai/contents",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({ ids: [url], text: true }),
    },
    timeoutMs,
  );

  if (!r.ok) {
    return { success: false, status: r.timeout ? 504 : 502, error: r.error };
  }
  const upstreamMs = Date.now() - upstreamStart;
  const { json } = await readJsonOrText(r.res);
  if (!r.res.ok) {
    return {
      success: false,
      status: r.res.status,
      error: (typeof json?.error === "string" ? json.error : null) || `Exa error: ${r.res.status}`,
    };
  }
  const results = Array.isArray(json?.results) ? json.results : [];
  const first = (isRecord(results[0]) ? results[0] : {}) as JsonRecord & {
    text?: string;
    title?: string;
  };
  const text = truncate(first.text || "", maxCharacters);
  return {
    success: true,
    data: buildData({
      provider: "exa",
      url,
      title: first.title || null,
      format: fmt,
      text,
      costUsd: costPerQuery,
      responseMs: Date.now() - startedAt,
      upstreamMs,
    }),
  };
}
