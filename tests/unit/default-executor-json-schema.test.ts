/**
 * Unit tests for DefaultExecutor.transformRequest — json_schema fallback for
 * `openai-compatible-*` providers that lack native Structured Output.
 */

import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.ts";

describe("DefaultExecutor.transformRequest — json_schema fallback", () => {
  const schema = {
    type: "object",
    properties: { answer: { type: "number" } },
    required: ["answer"],
  };

  const buildBody = () => ({
    model: "deepseek-chat",
    messages: [{ role: "user", content: "What is 2+2?" }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "math_response", schema },
    },
  });

  it("downgrades json_schema to json_object and injects schema into a new system message for openai-compatible-*", () => {
    const exec = new DefaultExecutor("openai-compatible-deepseek");
    const out = exec.transformRequest("deepseek-chat", buildBody());

    expect(out.response_format).toEqual({ type: "json_object" });
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toContain("math_response");
    expect(out.messages[0].content).toContain('"answer"');
    expect(out.messages[0].content).toContain("Respond ONLY with the JSON object");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("merges schema instruction into the existing system message instead of prepending a new one", () => {
    const exec = new DefaultExecutor("openai-compatible-ollama");
    const body = {
      model: "llama3",
      messages: [
        { role: "system", content: "You are a calculator." },
        { role: "user", content: "What is 2+2?" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "calc", schema } },
    };

    const out = exec.transformRequest("llama3", body);
    expect(out.messages.length).toBe(2);
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toContain("You are a calculator.");
    expect(out.messages[0].content).toContain("calc");
  });

  it("supports the openai-compatible-responses variant the same way", () => {
    const exec = new DefaultExecutor("openai-compatible-responses-foo");
    const out = exec.transformRequest("foo", buildBody());
    expect(out.response_format).toEqual({ type: "json_object" });
    expect(out.messages[0].role).toBe("system");
  });

  it("does not touch json_schema for native openai (which supports Structured Output natively)", () => {
    const exec = new DefaultExecutor("openai");
    const out = exec.transformRequest("gpt-4o", buildBody());
    expect(out.response_format.type).toBe("json_schema");
    expect(out.response_format.json_schema.schema).toEqual(schema);
  });

  it("does not touch requests without response_format", () => {
    const exec = new DefaultExecutor("openai-compatible-foo");
    const body = { model: "x", messages: [{ role: "user", content: "hi" }] };
    const out = exec.transformRequest("x", body);
    expect(out.response_format).toBeUndefined();
    // First (and only) message stays user — no schema system message injected
    expect(out.messages[0].role).toBe("user");
  });

  it("ignores json_object response_format (no schema to inject)", () => {
    const exec = new DefaultExecutor("openai-compatible-foo");
    const body = {
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    };
    const out = exec.transformRequest("x", body);
    expect(out.response_format).toEqual({ type: "json_object" });
    expect(out.messages[0].role).toBe("user");
  });

  it("does not mutate the input body (returns a new shape)", () => {
    const exec = new DefaultExecutor("openai-compatible-foo");
    const body = buildBody();
    const before = JSON.stringify(body);
    exec.transformRequest("x", body);
    expect(JSON.stringify(body)).toBe(before);
  });
});
