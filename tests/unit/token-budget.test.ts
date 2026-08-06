import { describe, expect, it } from "vitest";

import { reserveReasoningTokenBudget } from "../../open-sse/utils/tokenBudget.js";

describe("reserveReasoningTokenBudget", () => {
  it("raises small OpenAI-compatible max_tokens to leave room for reasoning", () => {
    const body = { model: "mercury-2", max_tokens: 100 };

    reserveReasoningTokenBudget(body, {
      provider: "openai-compatible-chat-test",
      model: "mercury-2",
      targetFormat: "openai",
    });

    expect(body.max_tokens).toBe(4096);
  });

  it("does not alter non-compatible providers or already sufficient budgets", () => {
    const openaiBody = { max_tokens: 8192 };
    const claudeBody = { max_tokens: 100 };

    reserveReasoningTokenBudget(openaiBody, {
      provider: "openai-compatible-chat-test",
      model: "mercury-2",
      targetFormat: "openai",
    });
    reserveReasoningTokenBudget(claudeBody, {
      provider: "claude",
      model: "claude-sonnet",
      targetFormat: "claude",
    });

    expect(openaiBody.max_tokens).toBe(8192);
    expect(claudeBody.max_tokens).toBe(100);
  });
});
