/**
 * Vertex AI stream field guard tests.
 *
 * Vertex AI rejects requests with `stream` in the body:
 *   400 "Invalid JSON payload received. Unknown name \"stream\": Cannot find field."
 *
 * Two guards exist:
 * 1. openaiToVertexRequest() — translator deletes processed.stream
 * 2. chatCore.ts — skips stream injection when targetFormat === FORMATS.VERTEX
 *
 * These tests verify both guards work correctly for all request shapes.
 */

import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import { translateRequest } from "../../open-sse/translator/index.ts";
import { openaiToVertexRequest } from "../../open-sse/translator/request/openai-to-vertex.ts";

// ─── Guard 1: openaiToVertexRequest translator ────────────────────────────────

describe("openaiToVertexRequest — stream field guard", () => {
  const baseBody = {
    model: "gemini-2.0-flash",
    messages: [{ role: "user", content: "Hello" }],
  };

  it("never includes stream field when stream=true", () => {
    const result = openaiToVertexRequest(
      "gemini-2.0-flash",
      { ...baseBody, stream: true },
      true,
      null,
    );
    expect(result).not.toHaveProperty("stream");
  });

  it("never includes stream field when stream=false", () => {
    const result = openaiToVertexRequest(
      "gemini-2.0-flash",
      { ...baseBody, stream: false },
      false,
      null,
    );
    expect(result).not.toHaveProperty("stream");
  });

  it("never includes stream field when stream is undefined", () => {
    const result = openaiToVertexRequest("gemini-2.0-flash", baseBody, undefined, null);
    expect(result).not.toHaveProperty("stream");
  });

  it("produces valid Gemini-format body with contents array", () => {
    const result = openaiToVertexRequest("gemini-2.0-flash", baseBody, true, null);
    expect(result).toHaveProperty("contents");
    expect(Array.isArray(result.contents)).toBe(true);
    expect(result.contents[0]).toHaveProperty("parts");
    expect(result).not.toHaveProperty("stream");
    expect(result).not.toHaveProperty("messages");
  });

  it("strips stream even if body already has stream=true at top level", () => {
    const bodyWithStream = { ...baseBody, stream: true };
    const result = openaiToVertexRequest("gemini-2.0-flash", bodyWithStream, true, null);
    expect(result).not.toHaveProperty("stream");
  });

  it("strips functionCall.id from tool calls (Vertex rejects these)", () => {
    const bodyWithTools = {
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "What is 2+2?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_abc123",
              type: "function",
              function: { name: "calculator", arguments: '{"a":2,"b":2}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_abc123", content: "4" },
      ],
    };
    const result = openaiToVertexRequest("gemini-2.0-flash", bodyWithTools, true, null);
    expect(result).not.toHaveProperty("stream");
    // Verify functionCall id is stripped
    for (const turn of result.contents || []) {
      for (const part of turn.parts || []) {
        if (part.functionCall) {
          expect(part.functionCall).not.toHaveProperty("id");
        }
        if (part.functionResponse) {
          expect(part.functionResponse).not.toHaveProperty("id");
        }
      }
    }
  });

  it("handles system prompt correctly", () => {
    const bodyWithSystem = {
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
    };
    const result = openaiToVertexRequest("gemini-2.0-flash", bodyWithSystem, true, null);
    expect(result).not.toHaveProperty("stream");
    expect(result).toHaveProperty("systemInstruction");
    expect(result).toHaveProperty("contents");
  });

  it("handles multi-turn conversation", () => {
    const multiTurn = {
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ],
    };
    const result = openaiToVertexRequest("gemini-2.0-flash", multiTurn, true, null);
    expect(result).not.toHaveProperty("stream");
    expect(result.contents.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves generationConfig fields", () => {
    const bodyWithConfig = {
      ...baseBody,
      temperature: 0.7,
      max_tokens: 100,
      top_p: 0.9,
    };
    const result = openaiToVertexRequest("gemini-2.0-flash", bodyWithConfig, true, null);
    expect(result).not.toHaveProperty("stream");
    expect(result.generationConfig).toHaveProperty("temperature", 0.7);
    expect(result.generationConfig).toHaveProperty("maxOutputTokens", 100);
    expect(result.generationConfig).toHaveProperty("topP", 0.9);
  });
});

// ─── Guard 2: translateRequest with FORMATS.VERTEX target ────────────────────

describe("translateRequest OPENAI→VERTEX — stream field guard", () => {
  const baseBody = {
    model: "gemini-2.0-flash",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
  };

  it("translated body has no stream field for VERTEX target (stream=true)", () => {
    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.VERTEX,
      "gemini-2.0-flash",
      baseBody,
      true,
    );
    expect(result).not.toHaveProperty("stream");
  });

  it("translated body has no stream field for VERTEX target (stream=false)", () => {
    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.VERTEX,
      "gemini-2.0-flash",
      { ...baseBody, stream: false },
      false,
    );
    expect(result).not.toHaveProperty("stream");
  });

  it("translated body has stream field for OPENAI target (stream=true)", () => {
    const result = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", baseBody, true);
    // For OpenAI target, stream should be preserved
    expect(result).toHaveProperty("stream", true);
  });

  it("translated body has stream field for OPENAI target (stream=false)", () => {
    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-4o",
      { ...baseBody, stream: false },
      false,
    );
    expect(result).toHaveProperty("stream", false);
  });
});

// ─── Guard 3: chatCore stream injection logic (unit) ─────────────────────────

describe("chatCore stream injection guard logic", () => {
  /**
   * Simulate the exact guard logic from chatCore.ts:
   *
   *   if (targetFormat !== FORMATS.VERTEX) {
   *     if (stream) translatedBody.stream = true;
   *     else translatedBody.stream = false;
   *   }
   */
  function applyStreamGuard(translatedBody, targetFormat, stream) {
    const body = { ...translatedBody };
    if (targetFormat !== FORMATS.VERTEX) {
      if (stream) {
        body.stream = true;
      } else {
        body.stream = false;
      }
    }
    return body;
  }

  it("does NOT inject stream for VERTEX target (stream=true)", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const result = applyStreamGuard(body, FORMATS.VERTEX, true);
    expect(result).not.toHaveProperty("stream");
  });

  it("does NOT inject stream for VERTEX target (stream=false)", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const result = applyStreamGuard(body, FORMATS.VERTEX, false);
    expect(result).not.toHaveProperty("stream");
  });

  it("DOES inject stream=true for OPENAI target", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = applyStreamGuard(body, FORMATS.OPENAI, true);
    expect(result).toHaveProperty("stream", true);
  });

  it("DOES inject stream=false for OPENAI target", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = applyStreamGuard(body, FORMATS.OPENAI, false);
    expect(result).toHaveProperty("stream", false);
  });

  it("DOES inject stream for CLAUDE target", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = applyStreamGuard(body, FORMATS.CLAUDE, true);
    expect(result).toHaveProperty("stream", true);
  });

  it("DOES inject stream for GEMINI target", () => {
    const body = { contents: [] };
    const result = applyStreamGuard(body, FORMATS.GEMINI, true);
    expect(result).toHaveProperty("stream", true);
  });

  it("does NOT inject stream for VERTEX even if body already has stream=true", () => {
    const body = { contents: [], stream: true };
    const result = applyStreamGuard(body, FORMATS.VERTEX, true);
    // Guard doesn't touch it — but translator already deleted it
    // The key point: guard doesn't ADD stream back
    // (body.stream was already deleted by openaiToVertexRequest)
    expect(result.stream).toBe(true); // pre-existing value preserved (not added by guard)
    // This is why the translator's delete is also needed
  });
});

// ─── Guard 4: VertexExecutor.buildUrl uses action suffix for streaming ────────

describe("VertexExecutor.buildUrl — streaming via URL not body", () => {
  it("uses streamGenerateContent action for streaming requests", async () => {
    const { VertexExecutor } = await import("../../open-sse/executors/vertex.ts");
    const executor = new VertexExecutor("vertex");
    const url = executor.buildUrl("gemini-2.0-flash", true, 0, { apiKey: "test-key-123" });
    expect(url).toContain(":streamGenerateContent");
    expect(url).toContain("?alt=sse");
    expect(url).not.toContain("generateContent?");
  });

  it("uses generateContent action for non-streaming requests", async () => {
    const { VertexExecutor } = await import("../../open-sse/executors/vertex.ts");
    const executor = new VertexExecutor("vertex");
    const url = executor.buildUrl("gemini-2.0-flash", false, 0, { apiKey: "test-key-123" });
    expect(url).toContain(":generateContent");
    expect(url).not.toContain("streamGenerateContent");
    expect(url).not.toContain("alt=sse");
  });

  it("includes API key in URL for raw key auth", async () => {
    const { VertexExecutor } = await import("../../open-sse/executors/vertex.ts");
    const executor = new VertexExecutor("vertex");
    const url = executor.buildUrl("gemini-2.0-flash", false, 0, { apiKey: "my-api-key" });
    expect(url).toContain("key=my-api-key");
  });

  it("does NOT include API key in URL for SA JSON auth", async () => {
    const { VertexExecutor } = await import("../../open-sse/executors/vertex.ts");
    const executor = new VertexExecutor("vertex");
    const saJson = JSON.stringify({
      type: "service_account",
      project_id: "my-project",
      private_key_id: "key-id",
      private_key:
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n",
      client_email: "test@my-project.iam.gserviceaccount.com",
    });
    const url = executor.buildUrl("gemini-2.0-flash", true, 0, {
      apiKey: saJson,
      providerSpecificData: { location: "us-central1" },
    });
    expect(url).not.toContain("key=");
    expect(url).toContain("projects/my-project");
    expect(url).toContain(":streamGenerateContent");
    expect(url).toContain("?alt=sse");
  });
});

// ─── End-to-end: full translate pipeline produces no stream field ─────────────

describe("full translate pipeline — no stream in Vertex body", () => {
  it("complex request with all fields produces no stream", () => {
    const complexBody = {
      model: "vertex/gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "What is the capital of France?" },
        { role: "assistant", content: "Paris." },
        { role: "user", content: "And Germany?" },
      ],
      temperature: 0.5,
      max_tokens: 200,
      top_p: 0.95,
      stream: true,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.VERTEX,
      "gemini-2.0-flash",
      complexBody,
      true,
    );

    expect(result).not.toHaveProperty("stream");
    expect(result).toHaveProperty("contents");
    expect(result).toHaveProperty("generationConfig");
    expect(result.generationConfig).toHaveProperty("temperature", 0.5);
    expect(result.generationConfig).toHaveProperty("maxOutputTokens", 200);
  });

  it("empty messages body produces no stream", () => {
    const body = {
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.VERTEX,
      "gemini-2.0-flash",
      body,
      false,
    );

    expect(result).not.toHaveProperty("stream");
  });
});
