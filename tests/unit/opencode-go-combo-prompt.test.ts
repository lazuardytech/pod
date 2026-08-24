/**
 * Combo system prompt injection — OpenCode Go end-to-end verification.
 *
 * OpenCode Go has TWO upstream routes:
 *  - /zen/go/v1/chat/completions (OpenAI shape, default)
 *  - /zen/go/v1/messages (Anthropic/Claude shape, for minimax-m2.5/m2.7)
 *
 * The provider config declares `format: "openai"` but per-model targetFormat
 * in providerModels.js routes minimax-m2.5/m2.7 to Claude shape via
 * openaiToClaudeRequest translator. This test verifies the combo
 * systemPrompt survives that translation and reaches the upstream body.
 */

import { describe, expect, it } from "vitest";
import { injectComboSystemPrompt } from "../../open-sse/services/combo.ts";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.ts";

const PROMPT = "Selalu balas dalam Bahasa Indonesia. Gunakan format markdown.";

describe("OpenCode Go — combo systemPrompt injection (OpenAI route)", () => {
  it("non-Claude models get system message at messages[0] (OpenAI shape passthrough)", () => {
    // Combo points at "opencode-go/grok-code-fast-1" → uses /chat/completions
    const body = {
      messages: [{ role: "user", content: "Tulis fungsi fibonacci" }],
      stream: true,
    };
    injectComboSystemPrompt(body, PROMPT);

    expect(body.messages.length).toBe(2);
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe("Tulis fungsi fibonacci");
  });

  it("preserves user system message AND combo system message (combo first)", () => {
    const body = {
      messages: [
        { role: "system", content: "You are GPT." },
        { role: "user", content: "hi" },
      ],
    };
    injectComboSystemPrompt(body, PROMPT);

    expect(body.messages[0].content).toBe(PROMPT);
    expect(body.messages[1].content).toBe("You are GPT.");
    expect(body.messages[2].role).toBe("user");
  });
});

describe("OpenCode Go — combo systemPrompt injection (Claude route, minimax-m2.5/m2.7)", () => {
  it("minimax-m2.5: combo prompt → translated to top-level body.system", () => {
    // Step 1: combo handler injects system prompt into OpenAI-shape body
    const body = {
      messages: [{ role: "user", content: "Translate hello to Indonesian" }],
      stream: true,
    };
    injectComboSystemPrompt(body, PROMPT);

    // Step 2: chatCore detects targetFormat="claude" for this model and
    // translates OpenAI → Claude before sending to /zen/go/v1/messages.
    const claudeBody = openaiToClaudeRequest("minimax-m2.5", body, true);

    // The system message has been hoisted to the top-level `system` field as
    // Anthropic API requires (NOT in messages[]).
    expect(claudeBody.system).toBeDefined();
    // openaiToClaudeRequest returns system as either string or array of
    // {type:"text"} blocks. Normalize for assertion.
    const systemText = Array.isArray(claudeBody.system)
      ? claudeBody.system.map((b) => b.text || b).join("")
      : claudeBody.system;
    expect(systemText).toContain(PROMPT);

    // Messages array should NOT contain the system role anymore — Claude
    // rejects role=system inside messages[].
    expect(claudeBody.messages.every((m) => m.role !== "system")).toBe(true);
    // User message is preserved
    const userMsg = claudeBody.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
  });

  it("minimax-m2.7: same translation contract", () => {
    const body = { messages: [{ role: "user", content: "Q" }], stream: false };
    injectComboSystemPrompt(body, PROMPT);
    const claudeBody = openaiToClaudeRequest("minimax-m2.7", body, false);
    const systemText = Array.isArray(claudeBody.system)
      ? claudeBody.system.map((b) => b.text || b).join("")
      : claudeBody.system;
    expect(systemText).toContain(PROMPT);
    expect(claudeBody.model).toBe("minimax-m2.7");
  });

  it("combo prompt is prepended BEFORE existing user system (priority maintained)", () => {
    const body = {
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Q" },
      ],
    };
    injectComboSystemPrompt(body, PROMPT);
    const claudeBody = openaiToClaudeRequest("minimax-m2.5", body, true);

    const systemText = Array.isArray(claudeBody.system)
      ? claudeBody.system.map((b) => b.text || b).join("\n\n")
      : claudeBody.system;

    const promptIdx = systemText.indexOf(PROMPT);
    const conciseIdx = systemText.indexOf("Be concise.");
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(conciseIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeLessThan(conciseIdx); // combo first
  });
});

describe("OpenCode Go — buildUrl + buildHeaders honour route split", () => {
  it("buildUrl picks /messages for minimax-m2.5/m2.7, /chat/completions for others", async () => {
    // Dynamic import so we don't pull executors registry at top
    const { OpenCodeGoExecutor } = await import("../../open-sse/executors/opencode-go.ts");
    const exec = new OpenCodeGoExecutor();

    expect(exec.buildUrl("grok-code-fast-1")).toBe(
      "https://opencode.ai/zen/go/v1/chat/completions",
    );
    expect(exec.buildUrl("gpt-5")).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(exec.buildUrl("minimax-m2.5")).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(exec.buildUrl("minimax-m2.7")).toBe("https://opencode.ai/zen/go/v1/messages");
  });

  it("buildHeaders uses x-api-key + anthropic-version for Claude-format models", async () => {
    const { OpenCodeGoExecutor } = await import("../../open-sse/executors/opencode-go.ts");
    const exec = new OpenCodeGoExecutor();

    // Prime _lastModel via buildUrl (BaseExecutor.execute order)
    exec.buildUrl("minimax-m2.5");
    const headers = exec.buildHeaders({ apiKey: "sk-test-1234" }, true);
    expect(headers["x-api-key"]).toBe("sk-test-1234");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("buildHeaders uses Bearer for OpenAI-format models", async () => {
    const { OpenCodeGoExecutor } = await import("../../open-sse/executors/opencode-go.ts");
    const exec = new OpenCodeGoExecutor();
    exec.buildUrl("grok-code-fast-1");
    const headers = exec.buildHeaders({ apiKey: "sk-test-1234" }, true);
    expect(headers["Authorization"]).toBe("Bearer sk-test-1234");
    expect(headers["x-api-key"]).toBeUndefined();
  });
});
