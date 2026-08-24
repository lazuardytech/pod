import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.ts";
import {
  applyThinking,
  extractThinking,
  parseSuffix,
  stripThinkingSuffix,
} from "../../open-sse/translator/concerns/thinkingUnified.ts";

const apply = (
  targetFormat: string,
  model: string,
  body: Record<string, unknown>,
  provider: string | null,
) => {
  const b = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("parseSuffix", () => {
  it("parses level suffix", () => {
    expect(parseSuffix("gpt-5(high)")).toEqual({
      cleanModel: "gpt-5",
      override: { mode: "level", level: "high" },
    });
  });
  it("parses ultra suffix", () => {
    expect(parseSuffix("gpt-5.6-sol(ultra)")).toEqual({
      cleanModel: "gpt-5.6-sol",
      override: { mode: "level", level: "ultra" },
    });
  });
  it("parses numeric budget suffix", () => {
    expect(parseSuffix("model(8192)")).toEqual({
      cleanModel: "model",
      override: { mode: "budget", budget: 8192 },
    });
  });
  it("parses auto / none", () => {
    expect(parseSuffix("m(auto)").override).toEqual({ mode: "auto" });
    expect(parseSuffix("m(none)").override).toEqual({ mode: "none" });
  });
  it("no suffix → passthrough", () => {
    expect(parseSuffix("claude-opus-4.7")).toEqual({
      cleanModel: "claude-opus-4.7",
      override: null,
    });
  });
});

describe("stripThinkingSuffix", () => {
  it("leaves a clean model id", () => {
    expect(stripThinkingSuffix("gpt-5(high)")).toBe("gpt-5");
    expect(stripThinkingSuffix("gpt-5.6-sol(ultra)")).toBe("gpt-5.6-sol");
    expect(stripThinkingSuffix("claude-opus-4.7")).toBe("claude-opus-4.7");
  });
  it("does not treat hyphen Codex effort as a paren suffix", () => {
    expect(parseSuffix("gpt-5.3-codex-high")).toEqual({
      cleanModel: "gpt-5.3-codex-high",
      override: null,
    });
    expect(stripThinkingSuffix("gpt-5.3-codex-high")).toBe("gpt-5.3-codex-high");
  });
});

describe("extractThinking", () => {
  it("claude enabled+budget", () => {
    expect(extractThinking({ thinking: { type: "enabled", budget_tokens: 4096 } })).toEqual({
      mode: "budget",
      budget: 4096,
    });
  });
  it("openai reasoning_effort", () => {
    expect(extractThinking({ reasoning_effort: "high" })).toEqual({
      mode: "level",
      level: "high",
    });
  });
  it("no intent → null", () => {
    expect(extractThinking({ messages: [] })).toBeNull();
  });
});

describe("applyThinking per provider format", () => {
  it("claude 4.6+ → adaptive thinking + output_config", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoning_effort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
    expect(out.thinking).toEqual({ type: "adaptive" });
  });
  it("claude haiku → enabled+budget", () => {
    const out = apply("claude", "claude-haiku-4.5", { reasoning_effort: "high" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
  });
  it("gemini-3 → thinkingLevel", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoning_effort: "medium" }, "gemini");
    expect(
      (out.generationConfig as { thinkingConfig?: { thinkingLevel?: string } }).thinkingConfig
        ?.thinkingLevel,
    ).toBe("medium");
  });
  it("gemini-2.5 → thinkingBudget", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoning_effort: "high" }, "gemini");
    expect(
      (out.generationConfig as { thinkingConfig?: { thinkingBudget?: number } }).thinkingConfig
        ?.thinkingBudget,
    ).toBe(24576);
  });
  it("GLM off → enable_thinking:false", () => {
    const out = apply("openai", "glm-4.6", { reasoning_effort: "none" }, "glm");
    expect(out.enable_thinking).toBe(false);
    expect(out.thinking).toBeUndefined();
  });
  it("Qwen on → enable_thinking + thinking_budget", () => {
    const out = apply("openai", "qwen3-max", { reasoning_effort: "medium" }, "qwen");
    expect(out.enable_thinking).toBe(true);
    expect(out.thinking_budget).toBe(8192);
  });
  it("QwQ cannot disable → clamp minimal", () => {
    const out = apply("openai", "qwq-32b", { reasoning_effort: "none" }, "qwen");
    expect(out.enable_thinking).toBe(true);
  });
  it("DeepSeek → enabled + reasoning_effort high", () => {
    const out = apply("openai", "deepseek-v4-pro", { reasoning_effort: "low" }, "deepseek");
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });
  it("Kimi on → reasoning_effort", () => {
    const out = apply("openai", "kimi-k2.6", { reasoning_effort: "high" }, "kimi");
    expect(out.reasoning_effort).toBe("high");
  });
  it("MiniMax M3 → adaptive", () => {
    const out = apply("claude", "MiniMax-M3", { reasoning_effort: "high" }, "minimax");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });
  it("non-reasoning model → strips thinking", () => {
    const out = apply("openai", "gpt-4o", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });
  it("aggregator (siliconflow) GLM model → forced openai reasoning_effort", () => {
    const out = apply("openai", "zai-org/GLM-5", { reasoning_effort: "high" }, "siliconflow");
    expect(out.reasoning_effort).toBe("high");
    expect(out.enable_thinking).toBeUndefined();
  });
  it("suffix overrides body", () => {
    const out = apply("openai", "gpt-5(low)", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBe("low");
  });
  it("applies a supported Codex Ultra suffix", () => {
    const out = apply("openai-responses", "gpt-5.6-sol(ultra)", {}, "codex");
    expect(out.reasoning_effort).toBe("ultra");
  });
  it("Codex (ultra) strips the model and maps effort", () => {
    const executor = new CodexExecutor();
    const body = { input: [{ role: "user", content: "hello" }] };
    applyThinking("openai-responses", "gpt-5.6-sol(ultra)", body, "codex");
    executor.transformRequest("gpt-5.6-sol(ultra)", body, true, { accessToken: "test" });
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe("ultra");
  });
  it.each([
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-sol", "ultra", "ultra"],
    ["gpt-5.6-terra", "ultra", "ultra"],
    ["gpt-5.6-luna", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
  ])("normalizes Codex %s effort %s to %s", (model, effort, expected) => {
    const out = apply("openai-responses", model, { reasoning: { effort } }, "codex");
    expect(out.reasoning_effort).toBe(expected);
  });
  it("keeps Codex-only GPT-5.6 levels out of Kiro translation", () => {
    const out = apply("openai", "gpt-5.6-sol", { reasoning_effort: "max" }, "kiro");
    expect(out.reasoning_effort).toBe("xhigh");
  });
  it("hyphen Codex path still works", () => {
    const executor = new CodexExecutor();
    const body = { input: [{ role: "user", content: "hello" }] };
    executor.transformRequest("gpt-5.3-codex-high", body, true, { accessToken: "test" });
    expect(body.model).toBe("gpt-5.3-codex");
    expect(body.reasoning.effort).toBe("high");
  });
  it("paren Codex suffix is stripped before hyphen parse", () => {
    const executor = new CodexExecutor();
    const body = {
      input: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    };
    executor.transformRequest("gpt-5.3-codex(high)", body, true, { accessToken: "test" });
    expect(body.model).toBe("gpt-5.3-codex");
    expect(body.reasoning.effort).toBe("high");
  });
});
