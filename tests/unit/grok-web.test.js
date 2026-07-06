/**
 * Unit tests for grok-web executor
 *
 * Covers:
 *  - Cookie format variants (bare token, sso= prefix)
 *  - Browser fingerprint headers (Origin, Referer, User-Agent, traceparent, x-statsig-id)
 *  - Model mapping (all known models, unknown default)
 *  - Non-streaming response (token accumulation, modelResponse, fingerprint, usage)
 *  - Streaming response (SSE chunk shape, role delta, DONE marker)
 *  - Error handling (400, 401/403, 429, 502, empty body, stream error)
 *  - Request body shape (temporary, modelName, modelMode, deviceEnvInfo)
 *  - Message parsing (multi-part, system/developer roles)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrokWebExecutor } from "../../open-sse/executors/grok-web.js";

const originalFetch = global.fetch;

function mockGrokNdjson(events) {
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  return new Response(new Blob([lines]).stream(), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GrokWebExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ─── Cookie format variants ────────────────────────────────────────────

  describe("cookie format", () => {
    it("sends bare token as sso=cookie", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "my-token" },
      });
      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers["Cookie"]).toBe("sso=my-token");
    });

    it("strips sso= prefix from apiKey", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "sso=prefixed-token" },
      });
      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers["Cookie"]).toBe("sso=prefixed-token");
    });
  });

  // ─── Browser fingerprint headers ──────────────────────────────────────

  describe("browser fingerprint headers", () => {
    async function executeOnce() {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      return global.fetch.mock.calls[0][1].headers;
    }

    it("sends Origin, Referer, User-Agent", async () => {
      const headers = await executeOnce();
      expect(headers["Origin"]).toBe("https://grok.com");
      expect(headers["Referer"]).toBe("https://grok.com/");
      expect(headers["User-Agent"]).toContain("Chrome");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("sends traceparent in valid W3C format", async () => {
      const headers = await executeOnce();
      expect(headers["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
    });

    it("sends x-statsig-id and x-xai-request-id", async () => {
      const headers = await executeOnce();
      expect(headers["x-statsig-id"]).toBeTruthy();
      expect(headers["x-xai-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("sends Sec-* headers for Cloudflare bypass", async () => {
      const headers = await executeOnce();
      expect(headers["Sec-Ch-Ua"]).toContain("Chrome");
      expect(headers["Sec-Fetch-Dest"]).toBe("empty");
      expect(headers["Sec-Fetch-Mode"]).toBe("cors");
      expect(headers["Sec-Fetch-Site"]).toBe("same-origin");
    });

    it("sends Cache-Control and Accept-Encoding", async () => {
      const headers = await executeOnce();
      expect(headers["Cache-Control"]).toBe("no-cache");
      expect(headers["Accept-Encoding"]).toContain("gzip");
    });
  });

  // ─── Model mapping ─────────────────────────────────────────────────────

  describe("model mapping", () => {
    async function getPayload(model) {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model,
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      return JSON.parse(global.fetch.mock.calls[0][1].body);
    }

    it("maps grok-4 to grok-4 / MODEL_MODE_GROK_4", async () => {
      const body = await getPayload("grok-4");
      expect(body.modelName).toBe("grok-4");
      expect(body.modelMode).toBe("MODEL_MODE_GROK_4");
    });

    it("maps grok-3-thinking to grok-3 / MODEL_MODE_GROK_3_THINKING", async () => {
      const body = await getPayload("grok-3-thinking");
      expect(body.modelName).toBe("grok-3");
      expect(body.modelMode).toBe("MODEL_MODE_GROK_3_THINKING");
    });

    it("maps grok-4-mini to grok-4-mini / MODEL_MODE_GROK_4_MINI_THINKING", async () => {
      const body = await getPayload("grok-4-mini");
      expect(body.modelName).toBe("grok-4-mini");
      expect(body.modelMode).toBe("MODEL_MODE_GROK_4_MINI_THINKING");
    });

    it("maps grok-4.1-mini to grok-4-1-thinking-1129 / MODEL_MODE_GROK_4_1_MINI_THINKING", async () => {
      const body = await getPayload("grok-4.1-mini");
      expect(body.modelName).toBe("grok-4-1-thinking-1129");
      expect(body.modelMode).toBe("MODEL_MODE_GROK_4_1_MINI_THINKING");
    });

    it("maps grok-4.1-fast to MODEL_MODE_FAST", async () => {
      const body = await getPayload("grok-4.1-fast");
      expect(body.modelMode).toBe("MODEL_MODE_FAST");
    });

    it("maps grok-4.1-expert to MODEL_MODE_EXPERT", async () => {
      const body = await getPayload("grok-4.1-expert");
      expect(body.modelMode).toBe("MODEL_MODE_EXPERT");
    });

    it("maps grok-4.2 and grok-4.20 to grok-420 / MODEL_MODE_GROK_420", async () => {
      const body42 = await getPayload("grok-4.2");
      const body420 = await getPayload("grok-4.20");
      expect(body42.modelName).toBe("grok-420");
      expect(body420.modelName).toBe("grok-420");
      expect(body42.modelMode).toBe("MODEL_MODE_GROK_420");
    });

    it("defaults unknown model to grok-4.1-fast", async () => {
      const body = await getPayload("unknown-model-test");
      expect(body.modelName).toBe("grok-4-1-thinking-1129");
      expect(body.modelMode).toBe("MODEL_MODE_FAST");
    });
  });

  // ─── Request body shape ────────────────────────────────────────────────

  describe("request body", () => {
    async function getPayload() {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      return JSON.parse(global.fetch.mock.calls[0][1].body);
    }

    it("includes temporary: true", async () => {
      const body = await getPayload();
      expect(body.temporary).toBe(true);
    });

    it("includes deviceEnvInfo with screen dimensions", async () => {
      const body = await getPayload();
      expect(body.deviceEnvInfo).toBeDefined();
      expect(body.deviceEnvInfo.darkModeEnabled).toBe(false);
      expect(body.deviceEnvInfo.screenWidth).toBeGreaterThan(0);
      expect(body.deviceEnvInfo.screenHeight).toBeGreaterThan(0);
    });

    it("sets empty fileAttachments and imageAttachments", async () => {
      const body = await getPayload();
      expect(body.fileAttachments).toEqual([]);
      expect(body.imageAttachments).toEqual([]);
    });

    it("disables memory and keeps search enabled", async () => {
      const body = await getPayload();
      expect(body.disableSearch).toBe(false);
      expect(body.disableMemory).toBe(true);
    });
  });

  // ─── Non-streaming response ────────────────────────────────────────────

  describe("non-streaming response", () => {
    it("accumulates token deltas into full content", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([
            { result: { response: { token: "Hello " } } },
            { result: { response: { token: "world!" } } },
            { result: { response: { token: " How are you?" } } },
          ]),
        );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.choices[0].message.content).toBe("Hello world! How are you?");
      expect(json.object).toBe("chat.completion");
      expect(json.choices[0].finish_reason).toBe("stop");
    });

    it("uses modelResponse.message as fullMessage (overwrites tokens)", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGrokNdjson([
          { result: { response: { token: "old token " } } },
          {
            result: {
              response: { modelResponse: { message: "Final assembled response" } },
            },
          },
        ]),
      );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      const json = await response.json();
      expect(json.choices[0].message.content).toBe("Final assembled response");
    });

    it("includes usage token estimates", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "Hello world" } } } }]),
        );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      const json = await response.json();
      expect(json.usage).toBeDefined();
      expect(json.usage.prompt_tokens).toBeGreaterThan(0);
      expect(json.usage.completion_tokens).toBeGreaterThan(0);
      expect(json.usage.total_tokens).toBe(json.usage.prompt_tokens + json.usage.completion_tokens);
    });

    it("propagates system_fingerprint from llmInfo", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGrokNdjson([
          {
            result: {
              response: { llmInfo: { modelHash: "abc123hash" }, token: "resp" },
            },
          },
          {
            result: {
              response: {
                modelResponse: {
                  message: "done",
                  metadata: { llm_info: { modelHash: "def456hash" } },
                },
              },
            },
          },
        ]),
      );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      const json = await response.json();
      // Last modelResponse metadata wins
      expect(json.system_fingerprint).toBe("def456hash");
    });

    it("returns id starting with chatcmpl-grok-", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      const json = await response.json();
      expect(json.id).toMatch(/^chatcmpl-grok-/);
      expect(json.model).toBe("grok-4");
    });

    it("handles modelResponse with thinking content via isThinking model (thinkOpened never set — no reasoning_content)", async () => {
      // Note: current code has thinkOpened always false, so isThinking events do NOT
      // produce reasoning_content. Token-level isThinking content goes into regular delta.
      global.fetch = vi.fn().mockResolvedValue(
        mockGrokNdjson([
          {
            result: {
              response: {
                modelResponse: { message: "Hello from thinking model" },
              },
            },
          },
        ]),
      );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-3-thinking", // isThinking=true model
        body: { messages: [{ role: "user", content: "think deep" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      const json = await response.json();
      // Content comes from fullMessage, no reasoning_content
      expect(json.choices[0].message.content).toBe("Hello from thinking model");
      expect(json.choices[0].message.reasoning_content).toBeUndefined();
    });
  });

  // ─── Streaming response ────────────────────────────────────────────────

  describe("streaming response", () => {
    async function readSSEChunks(url, opts) {
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: true },
        stream: true,
        credentials: { apiKey: "t" },
      });
      const text = await response.text();
      const lines = text.split("\n");
      const dataLines = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
      return { response, text, dataLines };
    }

    it("first chunk has role=assistant delta", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(mockGrokNdjson([{ result: { response: { token: "answer" } } }]));
      const { dataLines } = await readSSEChunks();
      const first = JSON.parse(dataLines[0]);
      expect(first.object).toBe("chat.completion.chunk");
      expect(first.choices[0].delta.role).toBe("assistant");
    });

    it("emits content delta chunks", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([
            { result: { response: { token: "Hello" } } },
            { result: { response: { token: " world" } } },
          ]),
        );
      const { dataLines, text } = await readSSEChunks();
      const contentChunks = dataLines
        .slice(1, -1)
        .filter((l) => l !== "[DONE]")
        .map((l) => JSON.parse(l).choices[0].delta.content)
        .filter(Boolean);
      expect(contentChunks.length).toBeGreaterThanOrEqual(1);
      expect(contentChunks.join("")).toContain("Hello");
      // Last data line is [DONE]
      expect(text.trim().split("\n").filter(Boolean).pop()).toBe("data: [DONE]");
    });

    it("emits stop finish_reason at end", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(mockGrokNdjson([{ result: { response: { token: "answer" } } }]));
      const { dataLines } = await readSSEChunks();
      // Filter out [DONE] marker before parsing JSON
      const jsonLines = dataLines.filter((l) => l !== "[DONE]");
      const stopChunk = jsonLines[jsonLines.length - 1];
      const parsed = JSON.parse(stopChunk);
      expect(parsed.choices[0].finish_reason).toBe("stop");
    });

    it("handles isThinking tokens as regular content (not reasoning_content)", async () => {
      // Current behavior: isThinking token events are emitted as regular delta content.
      // No reasoning_content separation (thinkOpened never set).
      global.fetch = vi.fn().mockResolvedValue(
        mockGrokNdjson([
          {
            result: {
              response: {
                token: "I am thinking",
                isThinking: true,
                messageTag: "header",
              },
            },
          },
          {
            result: {
              response: { token: "Final answer", isThinking: false },
            },
          },
        ]),
      );
      const { dataLines } = await readSSEChunks();
      const nonMetadata = dataLines.slice(1, -1).filter((l) => l !== "[DONE]");
      const deltas = nonMetadata
        .map((l) => JSON.parse(l).choices[0].delta)
        .filter((d) => d.content);
      const hasThinking = deltas.some((d) => d.content.includes("I am thinking"));
      const hasReasoning = deltas.some((d) => d.reasoning_content);
      expect(hasThinking).toBe(true);
      expect(hasReasoning).toBe(false);
    });

    it("drops modelResponse fullMessage in streaming (only token deltas emitted)", async () => {
      // Known limitation: buildStreamingResponse only handles chunk.delta, not
      // chunk.fullMessage from modelResponse events. fullMessage content is
      // silently dropped in streaming mode.
      global.fetch = vi.fn().mockResolvedValue(
        mockGrokNdjson([
          { result: { response: { token: "partial " } } },
          {
            result: {
              response: {
                modelResponse: { message: "final message via modelResponse" },
              },
            },
          },
        ]),
      );
      const { dataLines } = await readSSEChunks();
      const jsonLines = dataLines.filter((l) => l !== "[DONE]");
      const nonFirstLast = jsonLines.slice(1, -1);
      const deltas = nonFirstLast
        .map((l) => JSON.parse(l).choices[0].delta)
        .filter((d) => d.content);
      // Only partial token delta is emitted, modelResponse fullMessage is dropped
      expect(deltas.some((d) => d.content.includes("partial"))).toBe(true);
      expect(deltas.some((d) => d.content.includes("final message"))).toBe(false);
    });
  });

  // ─── Error handling ────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 400 for empty messages array", async () => {
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [] },
        stream: false,
        credentials: { apiKey: "t" },
      });
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.message).toMatch(/missing|empty/i);
    });

    it("returns 400 for missing messages", async () => {
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: {},
        stream: false,
        credentials: { apiKey: "t" },
      });
      expect(response.status).toBe(400);
    });

    it("returns 400 for empty query after processing", async () => {
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "   " }] },
        stream: false,
        credentials: { apiKey: "t" },
      });
      expect(response.status).toBe(400);
    });

    it("returns 401 with auth failed message", async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "bad" },
      });
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error.message).toMatch(/auth failed|expired|cookie/i);
    });

    it("returns 403 with auth failed message (Cloudflare challenge path)", async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "bad" },
      });
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error.message).toMatch(/auth failed|cookie/i);
    });

    it("returns 429 with rate limited message", async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "c" },
      });
      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json.error.message).toMatch(/rate limited/i);
    });

    it("returns 502 when fetch throws (connection failure)", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "c" },
      });
      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json.error.message).toMatch(/ECONNREFUSED/i);
    });

    it("returns 502 on empty response body", async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "c" },
      });
      expect(response.status).toBe(502);
    });

    it("handles error events in NDJSON stream", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ error: { message: "Upstream internal error", code: "INTERNAL" } }]),
        );
      const exec = new GrokWebExecutor();
      const { response } = await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "c" },
      });
      expect(response.status).toBe(502);
      const json = await response.json();
      expect(json.error.message).toMatch(/Upstream internal error/i);
    });
  });

  // ─── Message parsing via execute ───────────────────────────────────────

  describe("message parsing", () => {
    async function getBody(messages) {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model: "grok-4",
        body: { messages, stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      return JSON.parse(global.fetch.mock.calls[0][1].body);
    }

    it("handles developer role as system", async () => {
      const body = await getBody([
        { role: "developer", content: "Be concise" },
        { role: "user", content: "hello" },
      ]);
      expect(body.message).toContain("system: Be concise");
      expect(body.message).toContain("hello");
    });

    it("handles multi-part content array", async () => {
      const body = await getBody([
        {
          role: "user",
          content: [
            { type: "text", text: "part1" },
            { type: "text", text: "part2" },
          ],
        },
      ]);
      expect(body.message).toContain("part1");
      expect(body.message).toContain("part2");
    });

    it("preserves conversation history prefixed by role", async () => {
      const body = await getBody([
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" },
      ]);
      // Last user message is bare; earlier messages prefixed with role
      expect(body.message).toContain("user: First question");
      expect(body.message).toContain("assistant: First answer");
      expect(body.message).toContain("Second question");
    });

    it("skips empty content messages", async () => {
      const body = await getBody([
        { role: "user", content: "" },
        { role: "user", content: "real" },
      ]);
      expect(body.message).not.toContain("user: ");
      expect(body.message).toBe("real");
    });
  });

  // ─── URL and method ────────────────────────────────────────────────────

  describe("network target", () => {
    it("POSTs to grok.com/rest/app-chat/conversations/new", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          mockGrokNdjson([{ result: { response: { modelResponse: { message: "ok" } } } }]),
        );
      const exec = new GrokWebExecutor();
      await exec.execute({
        model: "grok-4",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
        stream: false,
        credentials: { apiKey: "t" },
      });
      expect(global.fetch.mock.calls[0][0]).toBe(
        "https://grok.com/rest/app-chat/conversations/new",
      );
      expect(global.fetch.mock.calls[0][1].method).toBe("POST");
    });
  });
});
