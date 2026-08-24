/**
 * Unit tests for KiroExecutor body-gated transient retry.
 *
 * AWS CodeWhisperer (Kiro backend) surfaces overload as HTTP 500 with a
 * reason code in the body, e.g.
 *   { "message": "Encountered unexpectedly high load when processing the
 *      request, please try again.", "reason": "MODEL_TEMPORARILY_UNAVAILABLE" }
 *
 * Generic 500 retry would mask real bugs, so we only retry when the body
 * matches a known transient pattern.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Set up fetch mock BEFORE importing modules that capture global.fetch at
// module load (proxyFetch.js does `const originalFetch = globalThis.fetch`).
const fetchMock = vi.fn();
global.fetch = fetchMock;

let isTransientErrorBody;
let KiroExecutor;

beforeAll(async () => {
  ({ isTransientErrorBody } = await import("../../open-sse/config/errorConfig.ts"));
  ({ KiroExecutor } = await import("../../open-sse/executors/kiro.ts"));
});

describe("isTransientErrorBody — body classification", () => {
  it("matches AWS CodeWhisperer MODEL_TEMPORARILY_UNAVAILABLE", () => {
    const body = JSON.stringify({
      message: "Encountered unexpectedly high load when processing the request, please try again.",
      reason: "MODEL_TEMPORARILY_UNAVAILABLE",
    });
    expect(isTransientErrorBody(body)).toBe(true);
  });

  it('matches "unexpectedly high load" alone', () => {
    expect(isTransientErrorBody("Encountered unexpectedly high load")).toBe(true);
  });

  it("matches Anthropic-style overloaded", () => {
    expect(
      isTransientErrorBody('{"error":{"type":"overloaded_error","message":"Overloaded"}}'),
    ).toBe(true);
  });

  it("matches generic temporarily unavailable", () => {
    expect(isTransientErrorBody("Service temporarily unavailable")).toBe(true);
  });

  it("does NOT match generic 500 errors", () => {
    expect(isTransientErrorBody("Internal server error")).toBe(false);
    expect(isTransientErrorBody("null pointer exception")).toBe(false);
    expect(isTransientErrorBody('{"error":"validation failed"}')).toBe(false);
  });

  it("returns false for empty / non-string", () => {
    expect(isTransientErrorBody("")).toBe(false);
    expect(isTransientErrorBody(null)).toBe(false);
    expect(isTransientErrorBody(undefined)).toBe(false);
    expect(isTransientErrorBody(42)).toBe(false);
  });
});

describe("KiroExecutor.execute — body-gated 500 retry", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Speed up test: shrink jitter so we don't actually wait seconds
    vi.spyOn(Math, "random").mockReturnValue(0); // jitter = 0.5x of cap
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeKiroResponse = (body, status = 200) =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });

  const buildExec = (overrides = {}) => {
    const exec = new KiroExecutor();
    // Tighten retry timing for tests so they finish fast
    exec.config = {
      ...exec.config,
      transientRetry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 4, ...overrides },
    };
    return exec;
  };

  const callExecute = (exec) =>
    exec.execute({
      model: "claude-sonnet-4",
      body: { messages: [] },
      stream: false,
      credentials: { accessToken: "tok" },
      log: { debug: () => {}, warn: () => {} },
    });

  it("retries up to 3 times on 500 + MODEL_TEMPORARILY_UNAVAILABLE then succeeds", async () => {
    const transientBody = JSON.stringify({
      message: "Encountered unexpectedly high load when processing the request, please try again.",
      reason: "MODEL_TEMPORARILY_UNAVAILABLE",
    });

    fetchMock
      .mockResolvedValueOnce(makeKiroResponse(transientBody, 500))
      .mockResolvedValueOnce(makeKiroResponse(transientBody, 500))
      // 4th call (after 3 retries on attempts 1,2,3) succeeds
      .mockResolvedValueOnce(makeKiroResponse(new Uint8Array(0), 200));

    const exec = buildExec();
    const result = await callExecute(exec);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.response.status).toBe(200);
  });

  it("gives up after attempts exhausted and returns the last 500 response", async () => {
    const transientBody = JSON.stringify({ reason: "MODEL_TEMPORARILY_UNAVAILABLE" });
    fetchMock.mockResolvedValue(makeKiroResponse(transientBody, 500));

    const exec = buildExec({ attempts: 2 });
    const result = await callExecute(exec);

    // 1 initial + 2 retries = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.response.status).toBe(500);
  });

  it("does NOT retry generic 500 (no transient body)", async () => {
    fetchMock.mockResolvedValue(
      makeKiroResponse(JSON.stringify({ error: "Internal server error" }), 500),
    );

    const exec = buildExec();
    const result = await callExecute(exec);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(500);
  });

  it("retries 503 with overloaded body", async () => {
    fetchMock
      .mockResolvedValueOnce(makeKiroResponse('{"error":"overloaded"}', 503))
      .mockResolvedValueOnce(makeKiroResponse(new Uint8Array(0), 200));

    const exec = buildExec();
    const result = await callExecute(exec);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(200);
  });

  it("preserves response body for caller after body-peek (clone)", async () => {
    // After the retry budget is exhausted, caller (chatCore) needs to read the
    // body again via parseUpstreamError. Verify it's still readable.
    const transientBody = JSON.stringify({ reason: "MODEL_TEMPORARILY_UNAVAILABLE" });
    fetchMock.mockResolvedValue(makeKiroResponse(transientBody, 500));

    const exec = buildExec({ attempts: 1 });
    const result = await callExecute(exec);

    const text = await result.response.text();
    expect(text).toContain("MODEL_TEMPORARILY_UNAVAILABLE");
  });
});

describe("ERROR_RULES — checkFallbackError handles transient body patterns", () => {
  it("treats MODEL_TEMPORARILY_UNAVAILABLE as backoff (not flat 30s transient)", async () => {
    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.ts");
    const result = checkFallbackError(500, "MODEL_TEMPORARILY_UNAVAILABLE: high load", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.newBackoffLevel).toBe(1);
    // Backoff cooldown should differ from the flat TRANSIENT_COOLDOWN_MS (30000)
    expect(result.cooldownMs).not.toBe(30_000);
  });

  it('treats "unexpectedly high load" as backoff', async () => {
    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.ts");
    const result = checkFallbackError(
      500,
      "Encountered unexpectedly high load when processing the request",
      0,
    );
    expect(result.newBackoffLevel).toBe(1);
  });

  it("backoff escalates on consecutive failures", async () => {
    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.ts");
    const r1 = checkFallbackError(500, "model_temporarily_unavailable", 0);
    const r2 = checkFallbackError(500, "model_temporarily_unavailable", r1.newBackoffLevel);
    const r3 = checkFallbackError(500, "model_temporarily_unavailable", r2.newBackoffLevel);
    expect(r1.newBackoffLevel).toBe(1);
    expect(r2.newBackoffLevel).toBe(2);
    expect(r3.newBackoffLevel).toBe(3);
    expect(r3.cooldownMs).toBeGreaterThan(r1.cooldownMs);
  });
});
