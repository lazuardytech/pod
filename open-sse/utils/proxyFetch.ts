import { MEMORY_CONFIG } from "../config/runtimeConfig.ts";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map<string, unknown>();

// Faster fail-over for unreachable upstreams. Default undici connect timeout is ~10s
// (varies by environment); 20s gives slow networks room without hanging the request
// for the full 30s+ TCP retry window. Tunable via env for ops.
const CONNECT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PROXY_CONNECT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20_000;
})();

type ProxyOptions = {
  enabled?: boolean;
  connectionProxyEnabled?: boolean;
  url?: unknown;
  connectionProxyUrl?: unknown;
  noProxy?: unknown;
  connectionNoProxy?: unknown;
  vercelRelayUrl?: unknown;
  relayAuthToken?: unknown;
  upstreamTimeoutMs?: number;
  strictProxy?: boolean;
} | null;

type FetchOptions = RequestInit & {
  dispatcher?: unknown;
  headers?: HeadersInit & Record<string, string>;
};

function normalizeString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function shouldBypassByNoProxy(targetUrl: string, noProxyValue: unknown) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const patterns = noProxy
    .split(",")
    .map((p: string) => p.trim().toLowerCase())
    .filter(Boolean);

  return patterns.some((pattern: string) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl: string) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol: string;
  try {
    protocol = new URL(targetUrl).protocol;
  } catch {
    return null;
  }

  if (protocol === "https:") {
    return (
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
    );
  }

  return (
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  );
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl: unknown) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {
    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl: string, proxyOptions: ProxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl: unknown) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      const oldest = proxyDispatchers.keys().next().value;
      if (oldest !== undefined) proxyDispatchers.delete(oldest);
    }
    const { ProxyAgent } = await import("undici");
    proxyDispatchers.set(
      normalized,
      new ProxyAgent({ uri: normalized, connect: { timeout: CONNECT_TIMEOUT_MS } }),
    );
  }

  return proxyDispatchers.get(normalized);
}

export async function proxyAwareFetch(
  url: string | URL | Request | undefined,
  options: FetchOptions = {},
  proxyOptions: ProxyOptions = null,
) {
  const targetUrl = typeof url === "string" ? url : (url as URL | Request).toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const relayHeaders: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    const relayAuthToken = normalizeString(proxyOptions?.relayAuthToken);
    if (relayAuthToken) {
      relayHeaders["x-relay-auth"] = relayAuthToken;
    }

    // Forward configured upstream timeout so relay can enforce its own AbortController.
    // Subtract 5s from pod's timeout so relay times out first — deterministic race outcome.
    // Minimum 1s to avoid zero/negative timeout on very short upstream deadlines.
    const upstreamTimeoutMs = proxyOptions?.upstreamTimeoutMs;
    if (upstreamTimeoutMs !== undefined && upstreamTimeoutMs > 0) {
      const relayTimeoutMs = Math.max(1000, upstreamTimeoutMs - 5000);
      relayHeaders["x-relay-timeout"] = String(relayTimeoutMs);
    }
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url as RequestInfo, { ...options, dispatcher } as RequestInit);
    } catch (proxyError: unknown) {
      if (proxyOptions?.strictProxy === true) {
        throw new Error(
          `[ProxyFetch] Proxy required but failed (strictProxy=true): ${errorMessage(proxyError)}`,
        );
      }
      console.warn("[ProxyFetch] Proxy failed, falling back to direct");
      return originalFetch(url as RequestInfo, options);
    }
  }

  return originalFetch(url as RequestInfo, options);
}

/**
 * Patched global fetch with env-proxy support
 */
async function patchedFetch(url: string | URL | Request | undefined, options: FetchOptions = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch as typeof globalThis.fetch;
}

export default patchedFetch;
