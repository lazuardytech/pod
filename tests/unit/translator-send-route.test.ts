import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetProviderConnections = vi.fn();
const mockRefreshTokenByProvider = vi.fn();
const mockExecute = vi.fn();
const mockGetExecutor = vi.fn(() => ({ execute: mockExecute }));

vi.mock("open-sse/index.ts", () => ({
  getExecutor: mockGetExecutor,
  refreshTokenByProvider: mockRefreshTokenByProvider,
}));

vi.mock("@/lib/localDb.ts", () => ({
  getProviderConnections: mockGetProviderConnections,
}));

const { POST } = await import("@/app/api/translator/send/route.ts");

describe("POST /api/translator/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderConnections.mockResolvedValue([
      {
        isActive: true,
        apiKey: "test-key",
        accessToken: null,
        refreshToken: null,
        copilotToken: null,
        projectId: null,
        providerSpecificData: { baseUrl: "http://localhost:7070/v1" },
      },
    ]);
    mockRefreshTokenByProvider.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(body) {
    return new Request("https://pod.local/api/translator/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("keeps non-streaming requests non-streaming and preserves JSON content type", async () => {
    mockExecute.mockResolvedValue({
      response: new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const response = await POST(
      makeRequest({
        provider: "openai-compatible-freebuff",
        model: "deepseek/deepseek-v4-flash",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
      }),
    );

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek/deepseek-v4-flash",
        stream: false,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.text()).resolves.toBe('{"ok":true}');
  });

  it("preserves SSE content type for streaming requests", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    mockExecute.mockResolvedValue({
      response: new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      }),
    });

    const response = await POST(
      makeRequest({
        provider: "openai-compatible-freebuff",
        model: "deepseek/deepseek-v4-flash",
        body: { messages: [{ role: "user", content: "hi" }], stream: true },
      }),
    );

    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek/deepseek-v4-flash",
        stream: true,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(text).toContain("data: [DONE]");
  });

  it("does not leak raw upstream error bodies to the client", async () => {
    mockExecute.mockResolvedValue({
      response: new Response('{"secret":"token-should-not-leak"}', {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const response = await POST(
      makeRequest({
        provider: "openai-compatible-freebuff",
        model: "deepseek/deepseek-v4-flash",
        body: { messages: [{ role: "user", content: "hi" }], stream: false },
      }),
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: "Provider error: 502",
    });
    expect(JSON.stringify(body)).not.toContain("token-should-not-leak");
  });
});
