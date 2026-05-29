/**
 * Comprehensive tests for Codex response handling.
 *
 * Covers:
 *   1. CodexExecutor.buildHeaders — always sets Accept: text/event-stream
 *   2. convertResponsesStreamToJson — Responses API SSE parsing
 *   3. handleForcedSSEToJson — Codex empty Content-Type path
 *   4. disableCodexStreaming removal — tools + streaming correct
 *   5. parseSSEToOpenAIResponse — standard SSE safety net
 *   6. output_index fix — missing index in tool call events
 *
 * Live API findings (validated 2026-05-17):
 *   - Codex never sends Content-Type header on HTTP 200 success
 *   - stream: false in body → Codex returns HTTP 400
 *   - Codex always returns Responses API SSE format
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/usageDb.js", () => ({
  generateDetailId: vi.fn(() => "detail_test_001"),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn(() => ({})),
  extractRequestConfig: vi.fn(() => ({})),
  saveUsageStats: vi.fn(() => {}),
}));

// ── Sample SSE streams ────────────────────────────────────────────────────
const SAMPLE_CODEX_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_abc123","created_at":1747000000,"status":"in_progress"}}',
  "",
  "event: response.in_progress",
  'data: {"type":"response.in_progress","response":{"id":"resp_abc123","status":"in_progress"}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_001","status":"in_progress","role":"assistant","content":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","item_id":"msg_001","output_index":0,"content_index":0,"delta":"Hello"}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_001","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Hello"}]}}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_abc123","created_at":1747000000,"status":"completed","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}',
  "",
].join("\n");

const SAMPLE_CODEX_SSE_TOOL_CALLS = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_tool","created_at":1747000001,"status":"in_progress"}}',
  "",
  "event: response.output_item.added",
  'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_001","name":"get_weather","arguments":"{\\"city\\":\\"Tokyo\\"}"}}',
  "",
  // output_item.done with MISSING output_index (Codex tool call freeze bug)
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_001","name":"get_weather","arguments":"{\\"city\\":\\"Tokyo\\"}"}}',
  "",
  "event: response.output_item.done",
  'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"message","id":"msg_tool","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Sunny"}]}}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_tool","created_at":1747000001,"status":"completed","usage":{"input_tokens":20,"output_tokens":10,"total_tokens":30}}}',
  "",
].join("\n");

const SAMPLE_CODEX_SSE_FAILED = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_fail","created_at":1747000002,"status":"in_progress"}}',
  "",
  "event: response.failed",
  'data: {"type":"response.failed","response":{"id":"resp_fail","status":"failed"}}',
  "",
].join("\n");

// ── Helpers ───────────────────────────────────────────────────────────────
function makeStream(text) {
  const bytes = new TextEncoder().encode(text);
  let done = false;
  return {
    getReader() {
      return {
        async read() {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: bytes };
        },
        releaseLock() {},
        cancel() {},
      };
    },
  };
}

function makeResponse({ contentType, sseText }) {
  return {
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? contentType : null) },
    body: makeStream(sseText),
  };
}

// ── Group 1: CodexExecutor.buildHeaders ───────────────────────────────────
describe("CodexExecutor.buildHeaders — always SSE", () => {
  let executor;

  beforeEach(async () => {
    const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
    executor = new CodexExecutor();
  });

  it("sets Accept: text/event-stream when stream=false", () => {
    expect(executor.buildHeaders({ accessToken: "tok" }, false)["Accept"]).toBe("text/event-stream");
  });

  it("sets Accept: text/event-stream when stream=true", () => {
    expect(executor.buildHeaders({ accessToken: "tok" }, true)["Accept"]).toBe("text/event-stream");
  });

  it("sets Accept: text/event-stream when stream omitted", () => {
    expect(executor.buildHeaders({ accessToken: "tok" })["Accept"]).toBe("text/event-stream");
  });

  it("sets session_id from credentials.connectionId when no _currentSessionId", () => {
    executor._currentSessionId = null;
    expect(executor.buildHeaders({ accessToken: "tok", connectionId: "conn_abc" })["session_id"]).toBe("conn_abc");
  });

  it("falls back to 'default' when no connectionId and no _currentSessionId", () => {
    executor._currentSessionId = null;
    expect(executor.buildHeaders({ accessToken: "tok" })["session_id"]).toBe("default");
  });

  it("prefers _currentSessionId over credentials.connectionId", () => {
    executor._currentSessionId = "sess_internal";
    expect(executor.buildHeaders({ accessToken: "tok", connectionId: "conn_abc" })["session_id"]).toBe("sess_internal");
  });

  it("sets Authorization Bearer from accessToken", () => {
    expect(executor.buildHeaders({ accessToken: "my-token" })["Authorization"]).toBe("Bearer my-token");
  });
});

// ── Group 2: convertResponsesStreamToJson ─────────────────────────────────
describe("convertResponsesStreamToJson", () => {
  let convert;

  beforeEach(async () => {
    const mod = await import("../../open-sse/transformer/streamToJsonConverter.js");
    convert = mod.convertResponsesStreamToJson;
  });

  it("parses complete Codex SSE and returns output text", async () => {
    const result = await convert(makeStream(SAMPLE_CODEX_SSE));
    expect(result.id).toBe("resp_abc123");
    expect(result.status).toBe("completed");
    expect(result.object).toBe("response");
    expect(result.output[0].content[0].text).toBe("Hello");
  });

  it("extracts usage from response.completed", async () => {
    const result = await convert(makeStream(SAMPLE_CODEX_SSE));
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(15);
  });

  it("handles missing output_index in tool call events (freeze fix)", async () => {
    const result = await convert(makeStream(SAMPLE_CODEX_SSE_TOOL_CALLS));
    expect(result.status).toBe("completed");
    expect(result.output.length).toBe(2);
    expect(result.output[0].type).toBe("function_call");
    expect(result.output[1].type).toBe("message");
    expect(result.output[1].content[0].text).toBe("Sunny");
  });

  it("handles response.failed event", async () => {
    const result = await convert(makeStream(SAMPLE_CODEX_SSE_FAILED));
    expect(result.status).toBe("failed");
    expect(result.output.length).toBe(0);
  });

  it("returns empty output for empty stream", async () => {
    const result = await convert(makeStream(""));
    expect(result.output.length).toBe(0);
    expect(result.usage.input_tokens).toBe(0);
  });

  it("returns failed status for null stream", async () => {
    const result = await convert(null);
    expect(result.status).toBe("failed");
    expect(result.output).toEqual([]);
  });

  it("assigns sequential indices when all output_item.done events lack output_index", async () => {
    const sse = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_noidx","created_at":1747000006,"status":"in_progress"}}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_a","status":"completed","role":"assistant","content":[{"type":"output_text","text":"First"}]}}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_b","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Second"}]}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_noidx","created_at":1747000006,"status":"completed","usage":{"input_tokens":2,"output_tokens":2,"total_tokens":4}}}',
      "",
    ].join("\n");
    const result = await convert(makeStream(sse));
    expect(result.output.length).toBe(2);
    expect(result.output[0].id).toBe("msg_a");
    expect(result.output[1].id).toBe("msg_b");
  });

  it("orders output items by index when indices are non-contiguous", async () => {
    const sse = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_gap","created_at":1747000007,"status":"in_progress"}}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":2,"item":{"type":"message","id":"msg_z","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Last"}]}}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_x","status":"completed","role":"assistant","content":[{"type":"output_text","text":"First"}]}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_gap","created_at":1747000007,"status":"completed","usage":{"input_tokens":2,"output_tokens":2,"total_tokens":4}}}',
      "",
    ].join("\n");
    const result = await convert(makeStream(sse));
    expect(result.output[0].id).toBe("msg_x");
    expect(result.output[2].id).toBe("msg_z");
  });
});

// ── Group 3: handleForcedSSEToJson with Codex ─────────────────────────────
describe("handleForcedSSEToJson — Codex paths", () => {
  let handleForcedSSEToJson;
  let trackDone, appendLog, onFinalJsonResponse, onRequestSuccess;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
    handleForcedSSEToJson = mod.handleForcedSSEToJson;
    trackDone = vi.fn();
    appendLog = vi.fn(() => Promise.resolve());
    onFinalJsonResponse = vi.fn();
    onRequestSuccess = vi.fn();
  });

  function ctx(overrides = {}) {
    return {
      provider: "codex",
      model: "gpt-5.3-codex",
      sourceFormat: "openai",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      translatedBody: {},
      finalBody: {},
      requestStartTime: Date.now(),
      connectionId: "test_conn",
      apiKey: "test-key",
      clientRawRequest: { endpoint: "/v1/chat/completions", headers: {} },
      onRequestSuccess,
      trackDone,
      appendLog,
      onFinalJsonResponse,
      ...overrides,
    };
  }

  it("enters codex path when Content-Type is empty (Codex never sends it)", async () => {
    const result = await handleForcedSSEToJson(
      ctx({
        providerResponse: makeResponse({ contentType: "", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(trackDone).toHaveBeenCalled();
  });

  it("enters codex path when Content-Type is text/event-stream", async () => {
    const result = await handleForcedSSEToJson(
      ctx({
        providerResponse: makeResponse({ contentType: "text/event-stream", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
  });

  it("returns null when provider is not codex and Content-Type is empty", async () => {
    const result = await handleForcedSSEToJson(
      ctx({
        provider: "openai",
        providerResponse: makeResponse({ contentType: "", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(result).toBeNull();
  });

  it("returns chat.completion JSON with correct content", async () => {
    const result = await handleForcedSSEToJson(
      ctx({
        providerResponse: makeResponse({ contentType: "", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage.prompt_tokens).toBe(10);
    expect(body.usage.completion_tokens).toBe(5);
    expect(body.usage.total_tokens).toBe(15);
  });

  it("returns Responses API JSON when sourceFormat=openai-responses", async () => {
    const result = await handleForcedSSEToJson(
      ctx({
        sourceFormat: "openai-responses",
        providerResponse: makeResponse({ contentType: "", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.object).toBe("response");
    expect(body.id).toBe("resp_abc123");
    expect(body.status).toBe("completed");
    expect(body.output[0].content[0].text).toBe("Hello");
  });

  it("calls onFinalJsonResponse with chat.completion and usage", async () => {
    await handleForcedSSEToJson(
      ctx({
        providerResponse: makeResponse({ contentType: "", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(onFinalJsonResponse).toHaveBeenCalledTimes(1);
    const [resp, usage] = onFinalJsonResponse.mock.calls[0];
    expect(resp.object).toBe("chat.completion");
    expect(usage.prompt_tokens).toBe(10);
  });

  it("calls onRequestSuccess", async () => {
    await handleForcedSSEToJson(
      ctx({
        providerResponse: makeResponse({ contentType: "", sseText: SAMPLE_CODEX_SSE }),
      }),
    );
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });

  it("extracts tool calls from function_call output items", async () => {
    const sseWithTool = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_tc","created_at":1747000005,"status":"in_progress"}}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_002","name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_tc","created_at":1747000005,"status":"completed","usage":{"input_tokens":8,"output_tokens":12,"total_tokens":20}}}',
      "",
    ].join("\n");
    const result = await handleForcedSSEToJson(
      ctx({
        providerResponse: makeResponse({ contentType: "", sseText: sseWithTool }),
      }),
    );
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(body.choices[0].message.content).toBeNull();
  });
});

// ── Group 4: disableCodexStreaming removal ────────────────────────────────
describe("CodexExecutor.transformRequest — stream always true", () => {
  let executor;

  beforeEach(async () => {
    const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
    executor = new CodexExecutor();
  });

  it("sets body.stream=true even when called with stream=false", () => {
    const body = { input: [{ role: "user", content: "hello" }], stream: false };
    executor.transformRequest("gpt-5.3-codex", body, false, { accessToken: "test" });
    expect(body.stream).toBe(true);
  });

  it("sets body.stream=true when tools are present (disableCodexStreaming removed)", () => {
    const body = {
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "my_tool", parameters: {} } }],
      stream: false,
    };
    executor.transformRequest("gpt-5.3-codex", body, false, { accessToken: "test" });
    expect(body.stream).toBe(true);
  });

  it("preserves tools array after transformRequest", () => {
    const body = {
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "my_tool", parameters: {} } }],
    };
    executor.transformRequest("gpt-5.3-codex", body, false, { accessToken: "test" });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("my_tool");
  });

  it("removes unsupported params (temperature, top_p, max_tokens, etc.)", () => {
    const body = {
      input: [{ role: "user", content: "hello" }],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      max_completion_tokens: 200,
      n: 2,
      seed: 42,
      user: "user-123",
      metadata: { key: "val" },
      stream_options: { include_usage: true },
    };
    executor.transformRequest("gpt-5.3-codex", body, true, { accessToken: "test" });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.n).toBeUndefined();
    expect(body.seed).toBeUndefined();
    expect(body.user).toBeUndefined();
    expect(body.metadata).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });

  it("injects default instructions when none provided", () => {
    const body = { input: [{ role: "user", content: "hello" }] };
    executor.transformRequest("gpt-5.3-codex", body, true, { accessToken: "test" });
    expect(typeof body.instructions).toBe("string");
    expect(body.instructions.length).toBeGreaterThan(0);
  });

  it("preserves existing instructions", () => {
    const body = { input: [{ role: "user", content: "hello" }], instructions: "Custom instructions" };
    executor.transformRequest("gpt-5.3-codex", body, true, { accessToken: "test" });
    expect(body.instructions).toBe("Custom instructions");
  });

  it("sets store=false", () => {
    const body = { input: [{ role: "user", content: "hello" }] };
    executor.transformRequest("gpt-5.3-codex", body, true, { accessToken: "test" });
    expect(body.store).toBe(false);
  });

  it("extracts effort level from model suffix and sets reasoning", () => {
    const body = { input: [{ role: "user", content: "hello" }] };
    executor.transformRequest("gpt-5.3-codex-xhigh", body, true, { accessToken: "test" });
    expect(body.reasoning).toBeDefined();
    expect(body.reasoning.effort).toBe("xhigh");
    expect(body.model).toBe("gpt-5.3-codex");
  });

  it("defaults reasoning effort to low when no suffix", () => {
    const body = { input: [{ role: "user", content: "hello" }] };
    executor.transformRequest("gpt-5.3-codex", body, true, { accessToken: "test" });
    expect(body.reasoning.effort).toBe("low");
  });
});

// ── Group 5: parseSSEToOpenAIResponse (standard SSE safety net) ───────────
describe("parseSSEToOpenAIResponse — standard Chat Completions SSE", () => {
  let parse;

  beforeEach(async () => {
    const mod = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
    parse = mod.parseSSEToOpenAIResponse;
  });

  it("returns null for empty input", () => {
    expect(parse("")).toBeNull();
  });

  it("returns null for input with no parseable data: lines", () => {
    expect(parse("event: foo\ndata: [DONE]")).toBeNull();
  });

  it("parses standard Chat Completions SSE chunks", () => {
    const sse = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1747000000,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1747000000,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1747000000,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
      "",
      "data: [DONE]",
    ].join("\n");
    const result = parse(sse);
    expect(result).not.toBeNull();
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0].message.content).toBe("Hello world");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage.prompt_tokens).toBe(10);
  });

  it("assembles tool_calls from streaming deltas", () => {
    const sse = [
      'data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1747000001,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1747000001,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"Paris\\"}"}}]},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-456","object":"chat.completion.chunk","created":1747000001,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    ].join("\n");
    const result = parse(sse);
    expect(result).not.toBeNull();
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("preserves reasoning_content", () => {
    const sse = [
      'data: {"id":"chatcmpl-789","object":"chat.completion.chunk","created":1747000002,"model":"gpt-4","choices":[{"index":0,"delta":{"reasoning_content":"Let me think","content":"Answer"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-789","object":"chat.completion.chunk","created":1747000002,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ].join("\n");
    const result = parse(sse);
    expect(result.choices[0].message.reasoning_content).toBe("Let me think");
    expect(result.choices[0].message.content).toBe("Answer");
  });
});
