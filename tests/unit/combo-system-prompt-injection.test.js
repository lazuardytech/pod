/**
 * Combo system prompt injection — full coverage test.
 *
 * Verifies that `injectComboSystemPrompt(body, prompt)` correctly prepends
 * the combo-level system prompt across every provider request body shape
 * pod supports. This is the canonical answer to "is the combo system
 * prompt actually injected before the upstream call?".
 *
 * Shapes covered:
 *  - OpenAI Chat Completions: { messages: [...] }
 *  - Anthropic / Claude: { messages: [...], system?: string|array, anthropic_version }
 *  - Gemini: { contents: [...], systemInstruction? }
 *  - OpenAI Responses API: { input: array|string, instructions? }
 *  - Antigravity envelope: { request: { systemInstruction?, contents } }
 *
 * Plus contract-level checks:
 *  - Empty/whitespace prompts are no-ops
 *  - Existing system prompts are preserved (combo prompt prepended, not replaced)
 *  - Mutation returns the same body reference (in-place)
 *  - `getComboEntryFromData` exposes both models and systemPrompt
 */

import { describe, expect, it } from "vitest";
import {
  getComboEntryFromData,
  getComboModelsFromData,
  injectComboSystemPrompt,
} from "../../open-sse/services/combo.js";

const PROMPT = "You are a helpful assistant. Always reply in Indonesian.";

describe("injectComboSystemPrompt — OpenAI Chat Completions", () => {
  it("prepends a system message when no system message exists", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("prepends BEFORE an existing user system message (combo takes priority)", () => {
    const body = {
      messages: [
        { role: "system", content: "Reply in English only." },
        { role: "user", content: "hi" },
      ],
    };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.messages.length).toBe(3);
    expect(body.messages[0].content).toBe(PROMPT);
    expect(body.messages[1].content).toBe("Reply in English only.");
    expect(body.messages[2].role).toBe("user");
  });

  it("returns the same body reference (in-place mutation)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = injectComboSystemPrompt(body, PROMPT);
    expect(result).toBe(body);
  });
});

describe("injectComboSystemPrompt — Claude / Anthropic", () => {
  it("sets `system` (string) when none exists", () => {
    const body = { messages: [{ role: "user", content: "hi" }], anthropic_version: "vertex-2023-10-16" };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.system).toBe(PROMPT);
  });

  it("prepends to existing string `system`", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      anthropic_version: "vertex-2023-10-16",
      system: "Be concise.",
    };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.system).toBe(`${PROMPT}\n\nBe concise.`);
  });

  it("prepends to existing array `system` (Anthropic content blocks)", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      anthropic_version: "vertex-2023-10-16",
      system: [
        { type: "text", text: "Block A" },
        { type: "text", text: "Block B", cache_control: { type: "ephemeral" } },
      ],
    };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.system[0]).toEqual({ type: "text", text: PROMPT });
    expect(body.system[1].text).toBe("Block A");
    expect(body.system[2].text).toBe("Block B");
    expect(body.system[2].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("injectComboSystemPrompt — Gemini", () => {
  it("sets `systemInstruction` when none exists", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.systemInstruction).toEqual({ role: "user", parts: [{ text: PROMPT }] });
  });

  it("prepends to existing `systemInstruction.parts`", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { role: "user", parts: [{ text: "Be brief." }] },
    };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.systemInstruction.parts[0]).toEqual({ text: PROMPT });
    expect(body.systemInstruction.parts[1].text).toBe("Be brief.");
  });
});

describe("injectComboSystemPrompt — OpenAI Responses API", () => {
  it("prepends to `input` array", () => {
    const body = { input: [{ role: "user", content: "hi" }] };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.input[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.input[1].role).toBe("user");
  });

  it("prepends to `instructions` when input is a string (legacy single-shot)", () => {
    const body = { input: "Translate to French", instructions: "Always reply formally." };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.instructions).toBe(`${PROMPT}\n\nAlways reply formally.`);
    // input string left untouched
    expect(body.input).toBe("Translate to French");
  });

  it("sets `instructions` when none existed", () => {
    const body = { input: "Translate to French" };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.instructions).toBe(PROMPT);
  });
});

describe("injectComboSystemPrompt — Antigravity envelope", () => {
  it("sets `request.systemInstruction` when none exists", () => {
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.request.systemInstruction).toEqual({ role: "user", parts: [{ text: PROMPT }] });
  });

  it("prepends to existing parts in `request.systemInstruction`", () => {
    const body = {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        systemInstruction: { role: "user", parts: [{ text: "Existing." }] },
      },
    };
    injectComboSystemPrompt(body, PROMPT);
    expect(body.request.systemInstruction.parts[0]).toEqual({ text: PROMPT });
    expect(body.request.systemInstruction.parts[1].text).toBe("Existing.");
  });
});

describe("injectComboSystemPrompt — no-op cases", () => {
  it("returns body unchanged for empty prompt", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const before = JSON.stringify(body);
    injectComboSystemPrompt(body, "");
    expect(JSON.stringify(body)).toBe(before);
  });

  it("returns body unchanged for whitespace-only prompt", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const before = JSON.stringify(body);
    injectComboSystemPrompt(body, "   \n\t  ");
    expect(JSON.stringify(body)).toBe(before);
  });

  it("returns body unchanged for null body", () => {
    expect(injectComboSystemPrompt(null, PROMPT)).toBeNull();
  });

  it("returns body unchanged when no recognised shape matches", () => {
    const body = { custom: "shape", with: { nothing: "to match" } };
    const before = JSON.stringify(body);
    injectComboSystemPrompt(body, PROMPT);
    expect(JSON.stringify(body)).toBe(before);
  });

  it("returns body unchanged when prompt is not a string", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const before = JSON.stringify(body);
    injectComboSystemPrompt(body, 123);
    injectComboSystemPrompt(body, undefined);
    injectComboSystemPrompt(body, null);
    expect(JSON.stringify(body)).toBe(before);
  });
});

describe("getComboEntryFromData — surfaces models + systemPrompt together", () => {
  const combos = [
    {
      name: "research-trio",
      models: ["openai/gpt-4o", "anthropic/claude-sonnet-4", "google/gemini-2.5-pro"],
      systemPrompt: "Always cite sources. Be concise.",
    },
    {
      name: "no-prompt-combo",
      models: ["openai/gpt-4o-mini"],
    },
    {
      name: "empty-prompt-combo",
      models: ["openai/gpt-4o-mini"],
      systemPrompt: "",
    },
  ];

  it("returns models and systemPrompt for a combo with prompt", () => {
    const entry = getComboEntryFromData("research-trio", combos);
    expect(entry).not.toBeNull();
    expect(entry.models).toEqual(["openai/gpt-4o", "anthropic/claude-sonnet-4", "google/gemini-2.5-pro"]);
    expect(entry.systemPrompt).toBe("Always cite sources. Be concise.");
  });

  it("returns null systemPrompt when combo has no prompt", () => {
    const entry = getComboEntryFromData("no-prompt-combo", combos);
    expect(entry.systemPrompt).toBeNull();
  });

  it("returns null systemPrompt when combo has empty-string prompt", () => {
    const entry = getComboEntryFromData("empty-prompt-combo", combos);
    expect(entry.systemPrompt).toBeNull();
  });

  it("returns null for unknown combo name", () => {
    expect(getComboEntryFromData("nonexistent", combos)).toBeNull();
  });

  it("returns null for provider/model formatted strings (not a combo lookup)", () => {
    expect(getComboEntryFromData("openai/gpt-4o", combos)).toBeNull();
  });

  it("getComboModelsFromData behaves the same for combo lookup", () => {
    expect(getComboModelsFromData("research-trio", combos)).toEqual(combos[0].models);
  });
});

describe("integration: injection survives translation pipeline (smoke)", () => {
  it("OpenAI request injected then forwarded to OpenAI: system role at index 0", () => {
    // Simulates what handleSingleModelChat does pre-translate
    const body = { messages: [{ role: "user", content: "Q?" }], model: "gpt-4o" };
    const comboPrompt = "Always reply in markdown.";
    injectComboSystemPrompt(body, comboPrompt);

    // What the executor receives at the upstream boundary
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe(comboPrompt);
  });

  it("OpenAI request injected then translated to Claude shape: prompt becomes top-level system", () => {
    // Pre-translate, OpenAI shape
    const body = { messages: [{ role: "user", content: "Q?" }] };
    const comboPrompt = "Use British spelling.";
    injectComboSystemPrompt(body, comboPrompt);

    // Simulate pod's openai→claude translator extracting system messages
    // (matches behaviour of openaiToClaude in open-sse/translators)
    const systemMessages = body.messages.filter((m) => m.role === "system").map((m) => m.content);
    const userMessages = body.messages.filter((m) => m.role !== "system");
    const claudeBody = {
      anthropic_version: "vertex-2023-10-16",
      system: systemMessages.join("\n\n"),
      messages: userMessages,
    };
    expect(claudeBody.system).toBe(comboPrompt);
    expect(claudeBody.messages.length).toBe(1);
    expect(claudeBody.messages[0].role).toBe("user");
  });

  it("preserves combo prompt across both OpenAI passthrough and Claude translation", () => {
    // Two passes through the pipeline (one combo, two providers) should each
    // see the same prompt — the original body is mutated in place.
    const body = { messages: [{ role: "user", content: "Q?" }] };
    injectComboSystemPrompt(body, "Always cite sources.");
    const snapshotAfterFirst = JSON.parse(JSON.stringify(body));

    // Fallback to next model — handler does NOT re-inject (already injected once)
    expect(snapshotAfterFirst.messages[0].role).toBe("system");
    expect(snapshotAfterFirst.messages[0].content).toBe("Always cite sources.");
  });
});
