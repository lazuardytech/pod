const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;

type UndiciProxyApi = {
  ProxyAgent: new (opts: { uri: string }) => { close?: () => void | Promise<void> };
  undiciFetch: (input: string, init?: Record<string, unknown> & { dispatcher?: unknown }) => Promise<Response>;
};

let undiciProxyApiPromise: Promise<UndiciProxyApi> | null = null;

async function getUndiciProxyApi(): Promise<UndiciProxyApi> {
  if (!undiciProxyApiPromise) {
    undiciProxyApiPromise = import("undici").then(({ ProxyAgent, fetch: undiciFetch }) => ({
      ProxyAgent: ProxyAgent as unknown as UndiciProxyApi["ProxyAgent"],
      undiciFetch: undiciFetch as unknown as UndiciProxyApi["undiciFetch"],
    }));
  }
  return undiciProxyApiPromise;
}

function getErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  const e = err as { message?: string; cause?: { code?: string; message?: string }; code?: string };
  const base = e.message || String(err);
  const causeCode = e.cause?.code || e.code;
  const causeMessage = e.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

type ProxyAgentLike = { close?: () => void | Promise<void> };

export type TestProxyUrlResult =
  | {
      ok: false;
      status: number;
      error: string;
    }
  | {
      ok: true;
      status: number;
      statusText: string;
      url: string;
      elapsedMs: number;
    };

export async function testProxyUrl({
  proxyUrl,
  testUrl,
  timeoutMs,
}: {
  proxyUrl?: unknown;
  testUrl?: unknown;
  timeoutMs?: unknown;
} = {}): Promise<TestProxyUrlResult> {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.min(timeoutMsRaw, 30000) : DEFAULT_TIMEOUT_MS;

  let dispatcher: ProxyAgentLike | null = null;

  try {
    const { ProxyAgent, undiciFetch } = await getUndiciProxyApi();

    try {
      dispatcher = new ProxyAgent({ uri: normalizedProxyUrl }) as ProxyAgentLike;
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${(err as Error)?.message || String(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher: dispatcher as unknown as object,
        signal: controller.signal,
        headers: {
          "User-Agent": "Pod",
        },
      });

      return res.ok
        ? {
            ok: true as const,
            status: res.status,
            statusText: res.statusText,
            url: normalizedTestUrl,
            elapsedMs: Date.now() - startedAt,
          }
        : {
            ok: false as const,
            status: res.status,
            error: `HTTP ${res.status} ${res.statusText || ""}`.trim(),
          };
    } catch (err) {
      const message = (err as { name?: string })?.name === "AbortError" ? "Proxy test timed out" : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}
