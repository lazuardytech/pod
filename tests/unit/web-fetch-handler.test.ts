/**
 * Unit tests for the web fetch dispatcher (open-sse/handlers/fetch/index.ts),
 * which backs the OpenAI-compatible /v1/web endpoint across the firecrawl,
 * jina-reader, tavily, and exa providers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleFetchCore } from "../../open-sse/handlers/fetch/index.ts";

const originalFetch = global.fetch;
const jsonHeaders = { "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = jsonHeaders) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("handleFetchCore — input validation", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects a missing url", async () => {
    const result = await handleFetchCore({
      url: "",
      provider: "firecrawl",
      providerConfig: null,
      credentials: null,
    });
    expect(result).toEqual({ success: false, status: 400, error: "url is required" });
  });

  it("rejects a missing provider", async () => {
    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "",
      providerConfig: null,
      credentials: null,
    });
    expect(result).toEqual({ success: false, status: 400, error: "provider is required" });
  });

  it("rejects an unsupported provider", async () => {
    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "not-a-provider",
      providerConfig: null,
      credentials: null,
    });
    expect(result).toEqual({
      success: false,
      status: 400,
      error: "Unsupported provider: not-a-provider",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("handleFetchCore — firecrawl", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts the scrape request and maps markdown content", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: { markdown: "# Hello\n\nbody text", metadata: { title: "Example" } },
      }),
    );

    const result = await handleFetchCore({
      url: "https://example.com/page",
      provider: "firecrawl",
      providerConfig: { costPerQuery: 0.002 },
      credentials: { apiKey: "fc-key" },
    });

    const [calledUrl, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.firecrawl.dev/v1/scrape");
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer fc-key" },
      body: JSON.stringify({ url: "https://example.com/page", formats: ["markdown"] }),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.provider).toBe("firecrawl");
    expect(data.url).toBe("https://example.com/page");
    expect(data.title).toBe("Example");
    expect((data.content as Record<string, unknown>).text).toBe("# Hello\n\nbody text");
    expect((data.usage as Record<string, unknown>).fetch_cost_usd).toBe(0.002);
  });

  it("falls back to html then text when markdown is absent", async () => {
    const html = jsonResponse({ data: { html: "<p>raw html</p>" } });
    const text = jsonResponse({ data: { text: "plain text" } });
    global.fetch = vi.fn().mockResolvedValueOnce(html).mockResolvedValueOnce(text);

    const htmlResult = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      providerConfig: null,
      credentials: null,
    });
    const textResult = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      providerConfig: null,
      credentials: null,
    });

    expect(htmlResult.success && (htmlResult.data as any).content.text).toBe("<p>raw html</p>");
    expect(textResult.success && (textResult.data as any).content.text).toBe("plain text");
  });

  it("truncates content when maxCharacters is set", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { markdown: "x".repeat(1000) } }));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      maxCharacters: 100,
      providerConfig: null,
      credentials: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const content = (result.data as Record<string, unknown>).content as {
      text: string;
      length: number;
    };
    expect(content.text).toBe("x".repeat(100));
    expect(content.length).toBe(100);
  });

  it("passes through upstream errors with provider error text", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "upstream says no" }, 429));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      providerConfig: null,
      credentials: null,
    });

    expect(result).toEqual({ success: false, status: 429, error: "upstream says no" });
  });

  it("falls back to a generic message when the upstream error body is unparseable", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response("<html>oops</html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      providerConfig: null,
      credentials: null,
    });

    expect(result).toEqual({ success: false, status: 500, error: "Firecrawl error: 500" });
  });

  it("returns empty content when the upstream JSON is malformed", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{not json", { status: 200, headers: jsonHeaders }));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "firecrawl",
      providerConfig: null,
      credentials: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as Record<string, unknown>).title).toBeNull();
    expect((result.data as any).content.text).toBe("");
  });
});

describe("handleFetchCore — jina-reader", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("gets the encoded URL and derives the title from the first H1", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("# Page Title\n\narticle body", { status: 200 }));

    const result = await handleFetchCore({
      url: "https://example.com/a b?q=1&x=2",
      provider: "jina-reader",
      providerConfig: null,
      credentials: { key: "jina-key" },
    });

    const [calledUrl, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://r.jina.ai/https%3A%2F%2Fexample.com%2Fa%20b%3Fq%3D1%26x%3D2");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ authorization: "Bearer jina-key" });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.title).toBe("Page Title");
    expect(data.provider).toBe("jina-reader");
  });

  it("omits the auth header when no credential exists", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("plain body", { status: 200 }));

    await handleFetchCore({
      url: "https://example.com",
      provider: "jina-reader",
      providerConfig: null,
      credentials: null,
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.headers).toEqual({});
  });

  it("uses the first 500 chars of the body as the upstream error message", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("x".repeat(900), { status: 404 }));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "jina-reader",
      providerConfig: null,
      credentials: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.length).toBe(500);
  });
});

describe("handleFetchCore — tavily", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts the extract request and maps the first raw_content", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ raw_content: "tavily content" }, { raw_content: "second" }] }),
      );

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "tavily",
      providerConfig: null,
      credentials: { apiKey: "tv-key" },
    });

    const [calledUrl, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.tavily.com/extract");
    expect(init.body).toBe(
      JSON.stringify({ urls: ["https://example.com"], extract_depth: "basic" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.title).toBeNull();
    expect((data.content as Record<string, unknown>).text).toBe("tavily content");
  });

  it("returns empty content when the result list is absent", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({}));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "tavily",
      providerConfig: null,
      credentials: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as any).content.text).toBe("");
  });
});

describe("handleFetchCore — exa", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts with x-api-key and maps the first result text", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ text: "exa result" }] }));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "exa",
      providerConfig: null,
      credentials: { token: "exa-token" },
    });

    const [calledUrl, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.exa.ai/contents");
    expect(init.headers).toMatchObject({ "x-api-key": "exa-token" });
    expect(init.body).toBe(JSON.stringify({ ids: ["https://example.com"], text: true }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as any).content.text).toBe("exa result");
  });
});

describe("handleFetchCore — transport failures", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("maps a timeout abort to 504", async () => {
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "jina-reader",
      providerConfig: { timeoutMs: 20 },
      credentials: null,
    });

    expect(result).toEqual({ success: false, status: 504, error: "aborted" });
  });

  it("maps a network failure to 502", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await handleFetchCore({
      url: "https://example.com",
      provider: "jina-reader",
      providerConfig: null,
      credentials: null,
    });

    expect(result).toEqual({ success: false, status: 502, error: "fetch failed" });
  });
});
