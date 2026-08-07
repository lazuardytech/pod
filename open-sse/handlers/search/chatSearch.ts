/**
 * Wrap chat-completions endpoints (with built-in web search) into the unified
 * /v1/search response format. Supports gemini, openai, xai, kimi, minimax.
 */

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 10;

type Citation = {
  url: string;
  title?: string;
  snippet?: string;
  link?: string;
  summary?: string;
};

type CitationCandidate = Partial<Citation> & {
  uri?: string;
};

type SearchExtract = {
  text: string;
  citations: CitationCandidate[];
  tokens: number;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  position: number;
  score: null;
  published_at: null;
  favicon_url: null;
  content: null;
  metadata: Record<string, never>;
  citation: { provider: string; retrieved_at: string; rank: number };
  provider_raw: null;
};

type ChatSearchConfig = {
  endpoint: (model: string) => string;
  defaultModel: string;
  buildBody: (query: string, model: string) => Record<string, unknown>;
  buildHeaders: (token: string) => Record<string, string>;
  extractAnswer: (data: unknown) => SearchExtract;
};

type ToolCallArguments = {
  search_results?: CitationCandidate[];
  results?: CitationCandidate[];
  references?: CitationCandidate[];
};

type ToolCall = {
  function?: { arguments?: string | ToolCallArguments };
};

type OpenAiLikePayload = {
  choices?: Array<{
    message?: {
      content?: string;
      annotations?: Array<{ url_citation?: CitationCandidate }>;
      tool_calls?: ToolCall[];
    };
  }>;
  citations?: unknown[];
  usage?: { total_tokens?: number };
  web_search_results?: CitationCandidate[];
};

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; url?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: { totalTokenCount?: number };
};

type ResponsesPayload = {
  output?: Array<{
    content?: Array<{
      text?: string;
      annotations?: Array<{ url?: string; url_citation?: CitationCandidate }>;
    }>;
  }>;
  citations?: unknown[];
  usage?: { total_tokens?: number };
};

type ChatSearchParams = {
  provider: string | undefined;
  query: string | undefined;
  maxResults?: number;
  model?: string;
  credentials?: Record<string, unknown> | null;
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Normalize a citation entry into the unified result shape.
 * @param {{url:string, title?:string, snippet?:string}} c
 * @param {number} index
 * @param {string} provider
 * @param {string} retrievedAt
 */
function toResult(
  c: CitationCandidate & { url: string },
  index: number,
  provider: string,
  retrievedAt: string,
): SearchResult {
  return {
    title: c.title || "",
    url: c.url,
    snippet: c.snippet || "",
    position: index + 1,
    score: null,
    published_at: null,
    favicon_url: null,
    content: null,
    metadata: {},
    citation: { provider, retrieved_at: retrievedAt, rank: index + 1 },
    provider_raw: null,
  };
}

/** Coerce a citation that might be a raw URL string or an object. */
function normalizeCitation(c: unknown): (CitationCandidate & { url: string }) | null {
  if (!c) return null;
  if (typeof c === "string") return { url: c };
  if (typeof c === "object" && "url" in c && typeof c.url === "string") {
    const candidate = c as CitationCandidate;
    return { ...candidate, url: c.url };
  }
  return null;
}

/**
 * Provider-specific configuration map. All providers must implement:
 * { endpoint, defaultModel, buildBody, buildHeaders, extractAnswer }
 */
const CHAT_SEARCH_CONFIG: Record<string, ChatSearchConfig> = {
  gemini: {
    endpoint: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    defaultModel: "gemini-2.5-flash",
    buildBody: (query) => ({
      contents: [{ role: "user", parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      "x-goog-api-key": token,
    }),
    extractAnswer: (data) => {
      const payload = data as GeminiPayload;
      const candidate = payload?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const text = parts
        .map((p) => p?.text || "")
        .filter(Boolean)
        .join("");
      const chunks = candidate?.groundingMetadata?.groundingChunks || [];
      const citations = chunks.flatMap((ch) => {
        const web = ch?.web;
        const url = web?.uri || web?.url;
        return url ? [{ url, title: web?.title || "" }] : [];
      });
      const tokens = payload?.usageMetadata?.totalTokenCount || 0;
      return { text, citations, tokens };
    },
  },

  openai: {
    endpoint: () => "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    buildBody: (query, model) => {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: query }],
      };
      // Non-search-preview models need explicit web_search tool
      if (!/search/i.test(model)) {
        body.tools = [{ type: "web_search" }];
      }
      return body;
    },
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    extractAnswer: (data) => {
      const payload = data as OpenAiLikePayload;
      const msg = payload?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const annotations = Array.isArray(msg.annotations) ? msg.annotations : [];
      const fromAnn = annotations.flatMap((annotation) => {
        const citation = annotation?.url_citation;
        return citation?.url ? [{ url: citation.url, title: citation.title || "" }] : [];
      });
      const fromTop = Array.isArray(payload?.citations)
        ? payload.citations
            .map(normalizeCitation)
            .filter((c): c is CitationCandidate & { url: string } => Boolean(c))
        : [];
      const citations = fromAnn.length ? fromAnn : fromTop;
      const tokens = payload?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    },
  },

  xai: {
    endpoint: () => "https://api.x.ai/v1/responses",
    defaultModel: "grok-4.20-reasoning",
    buildBody: (query, model) => ({
      model,
      input: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }],
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    extractAnswer: (data) => {
      const payload = data as ResponsesPayload;
      // /v1/responses returns output[] array of message/tool blocks
      const output = Array.isArray(payload?.output) ? payload.output : [];
      let text = "";
      const citations: CitationCandidate[] = [];
      for (const item of output) {
        const parts = Array.isArray(item?.content) ? item.content : [];
        for (const p of parts) {
          if (typeof p?.text === "string") text += p.text;
          const anns = Array.isArray(p?.annotations) ? p.annotations : [];
          for (const a of anns) {
            const c = normalizeCitation(a?.url ? a : a?.url_citation);
            if (c) citations.push(c);
          }
        }
      }
      // Fallback: top-level citations array (some response variants)
      if (!citations.length && Array.isArray(payload?.citations)) {
        for (const c of payload.citations) {
          const n = normalizeCitation(c);
          if (n) citations.push(n);
        }
      }
      const tokens = payload?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    },
  },

  kimi: {
    endpoint: () => "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "kimi-k2.5",
    buildBody: (query, model) => ({
      model,
      messages: [{ role: "user", content: query }],
      tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    extractAnswer: (data) => {
      const payload = data as OpenAiLikePayload;
      const msg = payload?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const citations: CitationCandidate[] = [];
      for (const call of calls) {
        const argStr = call?.function?.arguments;
        if (!argStr) continue;
        let parsed: ToolCallArguments;
        try {
          parsed = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
        } catch {
          continue;
        }
        const items = parsed?.search_results || parsed?.results || parsed?.references || [];
        if (Array.isArray(items)) {
          for (const it of items) {
            const url = it?.url || it?.link;
            if (!url) continue;
            citations.push({
              url,
              title: it.title || "",
              snippet: it.snippet || it.summary || "",
            });
          }
        }
      }
      const tokens = payload?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    },
  },

  minimax: {
    endpoint: () => "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    defaultModel: "MiniMax-M2.7",
    buildBody: (query, model) => ({
      model,
      messages: [{ role: "user", content: query }],
      tools: [{ type: "web_search" }],
    }),
    buildHeaders: (token) => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    extractAnswer: (data) => {
      const payload = data as OpenAiLikePayload;
      const msg = payload?.choices?.[0]?.message || {};
      const text = msg.content || "";
      const citations: CitationCandidate[] = [];
      const direct = Array.isArray(payload?.web_search_results) ? payload.web_search_results : [];
      for (const it of direct) {
        const url = it?.url || it?.link;
        if (url) {
          citations.push({
            url,
            title: it.title || "",
            snippet: it.snippet || it.summary || "",
          });
        }
      }
      if (!citations.length) {
        const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        for (const call of calls) {
          const argStr = call?.function?.arguments;
          if (!argStr) continue;
          let parsed: ToolCallArguments;
          try {
            parsed = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
          } catch {
            continue;
          }
          const items = parsed?.results || parsed?.search_results || [];
          if (Array.isArray(items)) {
            for (const it of items) {
              const url = it?.url || it?.link;
              if (!url) continue;
              citations.push({
                url,
                title: it.title || "",
                snippet: it.snippet || "",
              });
            }
          }
        }
      }
      const tokens = payload?.usage?.total_tokens || 0;
      return { text, citations, tokens };
    },
  },
};

/**
 * Execute a chat-search request against the chosen provider.
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.query
 * @param {number} [params.maxResults]
 * @param {string} [params.model]
 * @param {{apiKey?:string, accessToken?:string}} params.credentials
 * @param {{info?:Function, warn?:Function, error?:Function}} [params.log]
 * @returns {Promise<{success:boolean, status?:number, error?:string, data?:object}>}
 */
export async function handleChatSearch({
  provider,
  query,
  maxResults,
  model,
  credentials,
  log,
}: ChatSearchParams) {
  const startTime = Date.now();
  const providerId = provider || "";
  const cfg = CHAT_SEARCH_CONFIG[providerId];

  if (!cfg) {
    return {
      success: false,
      status: 400,
      error: `Unsupported chat-search provider: ${provider}`,
    };
  }

  if (!query || typeof query !== "string") {
    return { success: false, status: 400, error: "Missing query" };
  }

  const rawToken = credentials?.apiKey || credentials?.accessToken;
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!token) {
    return {
      success: false,
      status: 401,
      error: "Missing credentials (apiKey or accessToken)",
    };
  }

  const limit =
    typeof maxResults === "number" && Number.isFinite(maxResults) && maxResults > 0
      ? Math.floor(maxResults)
      : DEFAULT_MAX_RESULTS;
  const useModel = model || cfg.defaultModel;
  const url = cfg.endpoint(useModel);
  const body = cfg.buildBody(query, useModel);
  const headers = cfg.buildHeaders(token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const upstreamStart = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    if (isAbortError(err)) {
      log?.warn?.(`[chatSearch] timeout provider=${provider}`);
      return { success: false, status: 504, error: "Upstream timeout" };
    }
    const message = errorMessage(err);
    log?.error?.(`[chatSearch] network error provider=${provider}: ${message}`);
    return {
      success: false,
      status: 502,
      error: `Network error: ${message || "unknown"}`,
    };
  }
  clearTimeout(timer);
  const upstreamLatency = Date.now() - upstreamStart;

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    // Upstream returned a non-JSON body for a JSON chat-search endpoint.
    return {
      success: false,
      status: 502,
      error: `Invalid upstream response (status ${resp.status})`,
    };
  }

  if (!resp.ok) {
    const payload = data as { error?: { message?: unknown } | unknown; message?: unknown };
    const errorValue = payload.error;
    const errMsg =
      (typeof errorValue === "object" && errorValue && "message" in errorValue
        ? errorValue.message
        : undefined) ||
      errorValue ||
      payload.message ||
      `Upstream HTTP ${resp.status}`;
    log?.warn?.(`[chatSearch] upstream error provider=${provider} status=${resp.status}`);
    return {
      success: false,
      status: resp.status,
      error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg),
    };
  }

  const { text, citations, tokens } = cfg.extractAnswer(data);
  const retrievedAt = new Date().toISOString();
  const limited = (citations || []).slice(0, limit);
  const results = limited
    .map(normalizeCitation)
    .filter((c): c is CitationCandidate & { url: string } => Boolean(c))
    .map((c, i) => toResult(c, i, providerId, retrievedAt));

  return {
    success: true,
    status: 200,
    data: {
      provider: providerId,
      query,
      results,
      answer: { source: providerId, text: text || "", model: useModel },
      usage: { queries_used: 1, search_cost_usd: 0, llm_tokens: tokens || 0 },
      metrics: {
        response_time_ms: Date.now() - startTime,
        upstream_latency_ms: upstreamLatency,
        total_results_available: null,
      },
      errors: [],
    },
  };
}

export { CHAT_SEARCH_CONFIG };
