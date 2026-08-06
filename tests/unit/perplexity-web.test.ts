/**
 * Unit tests for perplexity-web executor
 *
 * Covers:
 *  - Message parsing (system/user/assistant/developer, multi-part content)
 *  - Query building for first turn vs follow-up (session continuity)
 *  - Tools injection into instructions
 *  - Request body shape (dual query_str top-level + params.query_str is required by upstream)
 *  - Auth header construction (apiKey → Cookie, accessToken → Bearer)
 *  - Model mapping (normal + thinking)
 *  - Error handling (401, 429)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPplxRequestBody,
  buildQuery,
  formatToolsHint,
  PerplexityWebExecutor,
  parseOpenAIMessages,
  sessionKey,
} from "../../open-sse/executors/perplexity-web.js";

const originalFetch = global.fetch;

function mockPplxStream(events) {
  const chunks = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new Blob([chunks]).stream(), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("parseOpenAIMessages", () => {
  it("extracts system + history + current msg", () => {
    const parsed = parseOpenAIMessages([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
    ]);
    expect(parsed.systemMsg.trim()).toBe("Be helpful");
    expect(parsed.history).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ]);
    expect(parsed.currentMsg).toBe("Q2");
  });

  it("treats developer role as system", () => {
    const parsed = parseOpenAIMessages([
      { role: "developer", content: "Be concise" },
      { role: "user", content: "hi" },
    ]);
    expect(parsed.systemMsg.trim()).toBe("Be concise");
    expect(parsed.currentMsg).toBe("hi");
  });

  it("handles multi-part content (array of text blocks)", () => {
    const parsed = parseOpenAIMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      },
    ]);
    expect(parsed.currentMsg).toBe("part1 part2");
  });

  it("skips empty content messages", () => {
    const parsed = parseOpenAIMessages([
      { role: "user", content: "   " },
      { role: "user", content: "real" },
    ]);
    expect(parsed.currentMsg).toBe("real");
  });
});

describe("buildQuery", () => {
  it("first turn: returns JSON with instructions + query", () => {
    const parsed = { systemMsg: "Be helpful\n", history: [], currentMsg: "Hello" };
    const q = buildQuery(parsed, null);
    const obj = JSON.parse(q);
    expect(obj.query).toBe("Hello");
    expect(obj.instructions).toContain("Be helpful");
    expect(obj.instructions.some((s) => s.includes("web search"))).toBe(true);
  });

  it("follow-up (with backendUuid): returns plain currentMsg, no JSON", () => {
    const parsed = {
      systemMsg: "Be helpful",
      history: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
      ],
      currentMsg: "Follow up",
    };
    const q = buildQuery(parsed, "uuid-abc-123");
    expect(q).toBe("Follow up");
  });

  it("includes history when present on first turn", () => {
    const parsed = {
      systemMsg: "",
      history: [{ role: "user", content: "earlier" }],
      currentMsg: "now",
    };
    const obj = JSON.parse(buildQuery(parsed, null));
    expect(obj.history).toEqual([{ role: "user", content: "earlier" }]);
    expect(obj.query).toBe("now");
  });

  it("injects tools into instructions on first turn", () => {
    const parsed = { systemMsg: "", history: [], currentMsg: "hi" };
    const tools = [
      { function: { name: "Shell", description: "Run bash" } },
      { function: { name: "Read", description: "Read file" } },
    ];
    const obj = JSON.parse(buildQuery(parsed, null, tools));
    const hint = obj.instructions.find((s) => s.includes("Available tools"));
    expect(hint).toBeDefined();
    expect(hint).toContain("- Shell: Run bash");
    expect(hint).toContain("- Read: Read file");
  });

  it("ignores tools on follow-up turn (uses session)", () => {
    const parsed = { systemMsg: "", history: [{ role: "user", content: "x" }], currentMsg: "y" };
    const tools = [{ function: { name: "Shell", description: "d" } }];
    const q = buildQuery(parsed, "uuid", tools);
    expect(q).toBe("y");
  });

  it("truncates query if JSON exceeds 96000 chars", () => {
    const big = "x".repeat(100000);
    const parsed = { systemMsg: big, history: [], currentMsg: "hi" };
    const q = buildQuery(parsed, null);
    expect(q.length).toBeLessThanOrEqual(96000);
  });
});

describe("formatToolsHint", () => {
  it("returns empty string for no tools", () => {
    expect(formatToolsHint()).toBe("");
    expect(formatToolsHint([])).toBe("");
  });

  it("handles OpenAI tool schema (function wrapper)", () => {
    const out = formatToolsHint([{ function: { name: "Foo", description: "does foo" } }]);
    expect(out).toContain("- Foo: does foo");
  });

  it("handles flat tool schema", () => {
    const out = formatToolsHint([{ name: "Bar", description: "does bar" }]);
    expect(out).toContain("- Bar: does bar");
  });

  it("truncates long descriptions to first line, max 200 chars", () => {
    const longDesc = "line1\nline2\nline3";
    const out = formatToolsHint([{ function: { name: "X", description: longDesc } }]);
    expect(out).toContain("- X: line1");
    expect(out).not.toContain("line2");
  });
});

describe("buildPplxRequestBody", () => {
  it("sets query_str at both top-level AND params (required by upstream API)", () => {
    const body = buildPplxRequestBody("hello world", "concise", "pplx_pro", null);
    expect(body.query_str).toBe("hello world");
    expect(body.params.query_str).toBe("hello world");
  });

  it("includes required params", () => {
    const body = buildPplxRequestBody("q", "copilot", "claude46sonnet", "uuid-xyz");
    expect(body.params.search_focus).toBe("internet");
    expect(body.params.mode).toBe("copilot");
    expect(body.params.model_preference).toBe("claude46sonnet");
    expect(body.params.sources).toEqual(["web"]);
    expect(body.params.use_schematized_api).toBe(true);
    expect(body.params.is_incognito).toBe(true);
    expect(body.params.last_backend_uuid).toBe("uuid-xyz");
    expect(body.params.version).toBe("2.18");
  });
});

describe("PerplexityWebExecutor.execute", () => {
  let _capturedUrl;
  let capturedOpts;
  let capturedBody;

  beforeEach(() => {
    _capturedUrl = null;
    capturedOpts = null;
    capturedBody = null;
    global.fetch = vi.fn(async (url, opts) => {
      _capturedUrl = url;
      capturedOpts = opts;
      capturedBody = JSON.parse(opts.body);
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["answer"], progress: "DONE" },
            },
          ],
          status: "COMPLETED",
          backend_uuid: "resp-uuid-1",
        },
      ]);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("maps pplx-auto → mode=concise, pref=pplx_pro", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: "cookie-abc" },
    });
    expect(capturedBody.params.mode).toBe("concise");
    expect(capturedBody.params.model_preference).toBe("pplx_pro");
  });

  it("applies THINKING_MAP when reasoning_effort is set", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-opus",
      body: {
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        reasoning_effort: "high",
      },
      stream: false,
      credentials: { apiKey: "cookie-abc" },
    });
    expect(capturedBody.params.mode).toBe("copilot");
    expect(capturedBody.params.model_preference).toBe("claude46opusthinking");
  });

  it("sends Cookie header when credentials.apiKey provided", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: "my-session-token" },
    });
    expect(capturedOpts.headers.Cookie).toBe("__Secure-next-auth.session-token=my-session-token");
    expect(capturedOpts.headers.Authorization).toBeUndefined();
  });

  it("sends Bearer header when credentials.accessToken provided", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { accessToken: "tok-1" },
    });
    expect(capturedOpts.headers.Authorization).toBe("Bearer tok-1");
  });

  it("injects body.tools into query_str instructions", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: {
        messages: [{ role: "user", content: "what tools do you have?" }],
        tools: [{ function: { name: "Shell", description: "Execute commands" } }],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "c" },
    });
    const queryObj = JSON.parse(capturedBody.query_str);
    const toolsHint = queryObj.instructions.find((s) => s.includes("Available tools"));
    expect(toolsHint).toContain("- Shell: Execute commands");
  });

  it("returns 400 on missing messages", async () => {
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: {},
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(response.status).toBe(400);
  });

  it("surfaces upstream 401 with friendly auth message", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "bad" }), { status: 401 }),
    );
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "bad-cookie" },
    });
    expect(response.status).toBe(401);
    const j = await response.json();
    expect(j.error.message).toMatch(/auth failed|expired/i);
  });

  it("surfaces 429 with rate-limit message", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 429 }));
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(response.status).toBe(429);
    const j = await response.json();
    expect(j.error.message).toMatch(/rate limited/i);
  });

  it("surfaces 403 with auth failed message (Cloudflare challenge)", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 403 }));
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "bad" },
    });
    expect(response.status).toBe(403);
    const j = await response.json();
    expect(j.error.message).toMatch(/auth failed|session-token|expired/i);
  });

  it("returns 502 on empty response body", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(response.status).toBe(502);
  });

  it("returns 502 on fetch failure", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(response.status).toBe(502);
    const j = await response.json();
    expect(j.error.message).toMatch(/ECONNREFUSED/i);
  });
});

// ─── Cookie format variants ─────────────────────────────────────────────────

describe("cookie format variants", () => {
  let capturedHeaders;

  beforeEach(() => {
    capturedHeaders = null;
    global.fetch = vi.fn(async (_url, opts) => {
      capturedHeaders = opts.headers;
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["ok"], progress: "DONE" },
            },
          ],
          status: "COMPLETED",
        },
      ]);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends bare token as __Secure-next-auth.session-token cookie", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: "my-session-token-value" },
    });
    expect(capturedHeaders["Cookie"]).toBe(
      "__Secure-next-auth.session-token=my-session-token-value",
    );
    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });

  it("sends apiKey as-is when prefixed with full cookie name (no stripping at executor level)", async () => {
    // The executor does NOT strip __Secure-next-auth.session-token= prefix.
    // Prefix stripping is done in validation logic, not in the executor.
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: {
        apiKey: "__Secure-next-auth.session-token=prefixed-value",
      },
    });
    // Executor wraps whatever apiKey is in the Cookie header directly
    expect(capturedHeaders["Cookie"]).toBe(
      "__Secure-next-auth.session-token=__Secure-next-auth.session-token=prefixed-value",
    );
  });

  it("uses Bearer when accessToken is provided instead of apiKey", async () => {
    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { accessToken: "jwt-token-value" },
    });
    expect(capturedHeaders["Authorization"]).toBe("Bearer jwt-token-value");
    expect(capturedHeaders["Cookie"]).toBeUndefined();
  });
});

// ─── Tool injection edge cases (formatToolsHint) ────────────────────────────

describe("formatToolsHint edge cases", () => {
  it("returns empty string for null/undefined tools", () => {
    expect(formatToolsHint(null)).toBe("");
    expect(formatToolsHint(undefined)).toBe("");
  });

  it("handles single tool with complex parameter schema", () => {
    const tools = [
      {
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"],
              },
            },
            required: ["location"],
          },
        },
      },
    ];
    const hint = formatToolsHint(tools);
    expect(hint).toContain("- get_weather: Get weather for a location");
    // Complex schema details are NOT included in hint — only name+first line of description
    expect(hint).not.toContain("parameters");
    expect(hint).not.toContain("type: object");
  });

  it("handles multi-tool with diverse schemas", () => {
    const tools = [
      { function: { name: "search", description: "Search the web" } },
      { function: { name: "read", description: "Read file content" } },
      { function: { name: "write", description: "Write to file" } },
    ];
    const hint = formatToolsHint(tools);
    expect(hint).toContain("- search: Search the web");
    expect(hint).toContain("- read: Read file content");
    expect(hint).toContain("- write: Write to file");
  });

  it("handles flat tool schema (no function wrapper)", () => {
    const tools = [{ name: "direct_tool", description: "Direct schema" }];
    const hint = formatToolsHint(tools);
    expect(hint).toContain("- direct_tool: Direct schema");
  });

  it("handles unnamed tool gracefully", () => {
    const tools = [{ function: { description: "no name" } }];
    const hint = formatToolsHint(tools);
    expect(hint).toContain("- unnamed: no name");
  });

  it("handles null entries in tools array", () => {
    const hint = formatToolsHint([null, undefined]);
    expect(hint).toContain("- unnamed:");
  });

  it("truncates long descriptions to first line, max 200 chars", () => {
    const longDesc = "line1\nline2\n" + "x".repeat(300);
    const out = formatToolsHint([{ function: { name: "X", description: longDesc } }]);
    expect(out).toContain("- X: line1");
    expect(out).not.toContain("line2");
    expect(out.length).toBeLessThan(250);
  });
});

// ─── Session continuity (sessionKey) ────────────────────────────────────────

describe("sessionKey", () => {
  it("produces deterministic hash for same history", () => {
    const h1 = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ];
    const h2 = [
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ];
    expect(sessionKey(h1)).toBe(sessionKey(h2));
  });

  it("produces different hashes for different content", () => {
    const h1 = [{ role: "user", content: "hello" }];
    const h2 = [{ role: "user", content: "world" }];
    expect(sessionKey(h1)).not.toBe(sessionKey(h2));
  });

  it("returns consistent 8-char hex string", () => {
    const key = sessionKey([{ role: "user", content: "test" }]);
    expect(key).toMatch(/^[0-9a-f]{8}$/);
  });

  it("handles empty history", () => {
    expect(sessionKey([])).toMatch(/^[0-9a-f]{8}$/);
  });

  it("includes role in hash computation", () => {
    const h1 = [{ role: "user", content: "same" }];
    const h2 = [{ role: "assistant", content: "same" }];
    expect(sessionKey(h1)).not.toBe(sessionKey(h2));
  });
});

// ─── Streaming edge cases ───────────────────────────────────────────────────

describe("streaming edge cases", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("handles multiple progressive IN_PROGRESS chunks", async () => {
    global.fetch = vi.fn(async () =>
      mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["Building "], progress: "IN_PROGRESS" },
            },
          ],
        },
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["Building response "], progress: "IN_PROGRESS" },
            },
          ],
        },
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: {
                chunks: ["Building response step by step"],
                progress: "DONE",
              },
            },
          ],
          status: "COMPLETED",
        },
      ]),
    );
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "build" }], stream: true },
      stream: true,
      credentials: { apiKey: "c" },
    });
    const text = await response.text();
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]");
    const contents = dataLines
      .map((l) => JSON.parse(l.slice(6)))
      .flatMap((d) => (d.choices[0].delta.content ? [d.choices[0].delta.content] : []))
      .join("");
    expect(contents).toContain("Building response");
  });

  it("handles empty blocks array gracefully (no content)", async () => {
    global.fetch = vi.fn(async () => mockPplxStream([{ blocks: [], status: "COMPLETED" }]));
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "test" }], stream: false },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("");
  });

  it("falls back to text field when no blocks present", async () => {
    global.fetch = vi.fn(async () =>
      mockPplxStream([{ text: "Fallback text answer", status: "COMPLETED", final: true }]),
    );
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "test" }], stream: false },
      stream: false,
      credentials: { apiKey: "c" },
    });
    const json = await response.json();
    expect(json.choices[0].message.content).toContain("Fallback text answer");
  });

  it("cleans citations and Grok tags from response", async () => {
    global.fetch = vi.fn(async () =>
      mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: {
                chunks: [
                  'The answer[1] is 42[2] <grok:render card_id="c1"><argument name="citation_id">3</argument></grok:render>.',
                ],
                progress: "DONE",
              },
            },
          ],
          status: "COMPLETED",
        },
      ]),
    );
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "test" }], stream: false },
      stream: false,
      credentials: { apiKey: "c" },
    });
    const json = await response.json();
    const content = json.choices[0].message.content;
    expect(content).not.toContain("[1]");
    expect(content).not.toContain("[2]");
    expect(content).not.toContain("grok:render");
    expect(content).toContain("The answer");
    expect(content).toContain("42");
  });

  it("cleans XML declarations and response tags", async () => {
    global.fetch = vi.fn(async () =>
      mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: {
                chunks: ['<?xml version="1.0"?><response>Final content</response>'],
                progress: "DONE",
              },
            },
          ],
          status: "COMPLETED",
        },
      ]),
    );
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "test" }], stream: false },
      stream: false,
      credentials: { apiKey: "c" },
    });
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("Final content");
  });
});

// ─── Session continuity (integration via executor) ──────────────────────────

describe("session continuity", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends JSON query for first turn (no session)", async () => {
    let capturedBody = null;
    global.fetch = vi.fn(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["First answer"], progress: "DONE" },
            },
          ],
          status: "COMPLETED",
          backend_uuid: "sess-abc-123",
        },
      ]);
    });

    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "First question" }], stream: false },
      stream: false,
      credentials: { apiKey: "c" },
    });

    // First turn: query_str is JSON with instructions + query
    const query = capturedBody.query_str;
    const obj = JSON.parse(query);
    expect(obj.query).toBe("First question");
    expect(obj.instructions).toBeDefined();
    expect(Array.isArray(obj.instructions)).toBe(true);
  });

  it("sends plain text for follow-up turn (session found)", async () => {
    let callCount = 0;
    let firstBody = null;
    let secondBody = null;

    global.fetch = vi.fn(async (_url, opts) => {
      const parsed = JSON.parse(opts.body);
      callCount++;
      if (callCount === 1) {
        firstBody = parsed;
        return mockPplxStream([
          {
            blocks: [
              {
                intended_usage: "markdown",
                markdown_block: {
                  chunks: ["First answer"],
                  progress: "DONE",
                },
              },
            ],
            status: "COMPLETED",
            backend_uuid: "sess-xyz-789",
          },
        ]);
      }
      secondBody = parsed;
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: {
                chunks: ["Second answer"],
                progress: "DONE",
              },
            },
          ],
          status: "COMPLETED",
          backend_uuid: "sess-xyz-789",
        },
      ]);
    });

    const exec = new PerplexityWebExecutor();

    // First turn: Q1
    await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "Q1" }], stream: false },
      stream: false,
      credentials: { apiKey: "c" },
    });

    // Second turn: includes context of Q1+A1, asks Q2
    // Session lookup should find backend_uuid from first turn
    await exec.execute({
      model: "pplx-auto",
      body: {
        messages: [
          { role: "user", content: "Q1" },
          { role: "assistant", content: "First answer" },
          { role: "user", content: "Q2" },
        ],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "c" },
    });

    // First turn: JSON query (no session)
    expect(() => JSON.parse(firstBody.query_str)).not.toThrow();
    const firstObj = JSON.parse(firstBody.query_str);
    expect(firstObj.query).toBe("Q1");

    // Second turn: plain text (session found via history match)
    expect(secondBody.query_str).toBe("Q2");

    // Second turn: last_backend_uuid populated from session
    expect(secondBody.params.last_backend_uuid).toBe("sess-xyz-789");
  });
});

// ─── Concurrent request edge cases ──────────────────────────────────────────

describe("concurrent requests", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("buildPplxRequestBody generates unique frontend_uuid per call", () => {
    const body1 = buildPplxRequestBody("q1", "concise", "pplx_pro", null);
    const body2 = buildPplxRequestBody("q2", "concise", "pplx_pro", null);
    expect(body1.params.frontend_uuid).not.toBe(body2.params.frontend_uuid);
    expect(body1.params.frontend_context_uuid).not.toBe(body2.params.frontend_context_uuid);
  });

  it("buildPplxRequestBody includes frontend_uuid and context_uuid", () => {
    const body = buildPplxRequestBody("test", "copilot", "gpt54", null);
    expect(body.params.frontend_uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.params.frontend_context_uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

// ─── Reasoning effort mapping ───────────────────────────────────────────────

describe("reasoning_effort", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("maps reasoning_effort=high to thinking mode for pplx-sonnet", async () => {
    let capturedBody = null;
    global.fetch = vi.fn(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["ok"], progress: "DONE" },
            },
          ],
          status: "COMPLETED",
        },
      ]);
    });

    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-sonnet",
      body: {
        messages: [{ role: "user", content: "test" }],
        stream: false,
        reasoning_effort: "high",
      },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(capturedBody.params.model_preference).toBe("claude46sonnetthinking");
    expect(capturedBody.params.mode).toBe("copilot");
  });

  it("maps reasoning_effort=none to normal mode", async () => {
    let capturedBody = null;
    global.fetch = vi.fn(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["ok"], progress: "DONE" },
            },
          ],
          status: "COMPLETED",
        },
      ]);
    });

    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-sonnet",
      body: {
        messages: [{ role: "user", content: "test" }],
        stream: false,
        reasoning_effort: "none",
      },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(capturedBody.params.model_preference).toBe("claude46sonnet");
  });
});

// ─── Unmapped model handling ────────────────────────────────────────────────

describe("unmapped model", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("passes unmapped model name as raw model_preference", async () => {
    let capturedBody = null;
    global.fetch = vi.fn(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockPplxStream([
        {
          blocks: [
            {
              intended_usage: "markdown",
              markdown_block: { chunks: ["ok"], progress: "DONE" },
            },
          ],
          status: "COMPLETED",
        },
      ]);
    });

    const exec = new PerplexityWebExecutor();
    await exec.execute({
      model: "pplx-custom-v3",
      body: {
        messages: [{ role: "user", content: "test" }],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "c" },
    });
    expect(capturedBody.params.model_preference).toBe("pplx-custom-v3");
    expect(capturedBody.params.mode).toBe("copilot");
  });
});

describe("PerplexityWebExecutor — x-pod-skip-reasoning header", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockStreamWithThinking() {
    return mockPplxStream([
      // Thinking chunk: search step
      {
        blocks: [
          {
            intended_usage: "pro_search_steps",
            plan_block: {
              steps: [
                {
                  step_type: "SEARCH_WEB",
                  search_web_content: { queries: [{ query: "test query" }] },
                },
              ],
            },
          },
        ],
      },
      // Markdown chunk: actual answer (in-progress so it streams as delta)
      {
        blocks: [
          {
            intended_usage: "markdown",
            markdown_block: { chunks: ["final answer"], progress: "IN_PROGRESS" },
          },
        ],
      },
      // Final DONE marker
      {
        blocks: [
          {
            intended_usage: "markdown",
            markdown_block: { chunks: ["final answer"], progress: "DONE" },
          },
        ],
        status: "COMPLETED",
      },
    ]);
  }

  it("includes reasoning_content when header is absent", async () => {
    global.fetch = vi.fn(async () => mockStreamWithThinking());
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
    });
    const j = await response.json();
    // Default behaviour: thinking is collected into reasoning_content
    expect(j.choices[0].message.reasoning_content).toContain("Searching: test query");
  });

  it("omits reasoning_content when x-pod-skip-reasoning: true", async () => {
    global.fetch = vi.fn(async () => mockStreamWithThinking());
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
      clientHeaders: { "x-pod-skip-reasoning": "true" },
    });
    const j = await response.json();
    expect(j.choices[0].message.reasoning_content).toBeUndefined();
    expect(j.choices[0].message.content).toBe("final answer");
  });

  it("omits reasoning_content when x-omniroute-skip-reasoning: true (back-compat)", async () => {
    global.fetch = vi.fn(async () => mockStreamWithThinking());
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
      clientHeaders: { "x-omniroute-skip-reasoning": "true" },
    });
    const j = await response.json();
    expect(j.choices[0].message.reasoning_content).toBeUndefined();
  });

  it("is case-insensitive on header name", async () => {
    global.fetch = vi.fn(async () => mockStreamWithThinking());
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "c" },
      clientHeaders: { "X-Pod-Skip-Reasoning": "true" },
    });
    const j = await response.json();
    expect(j.choices[0].message.reasoning_content).toBeUndefined();
  });

  it("streaming: drops reasoning_content chunks when skipReasoning enabled", async () => {
    global.fetch = vi.fn(async () => mockStreamWithThinking());
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { apiKey: "c" },
      clientHeaders: { "x-pod-skip-reasoning": "true" },
    });
    const text = await response.text();
    expect(text).not.toContain("reasoning_content");
    expect(text).toContain("final answer");
  });

  it("streaming: keeps reasoning_content chunks when skipReasoning disabled", async () => {
    global.fetch = vi.fn(async () => mockStreamWithThinking());
    const exec = new PerplexityWebExecutor();
    const { response } = await exec.execute({
      model: "pplx-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { apiKey: "c" },
    });
    const text = await response.text();
    expect(text).toContain("reasoning_content");
    expect(text).toContain("Searching: test query");
  });
});
