import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import { injectPonytail } from "../../open-sse/rtk/ponytail.ts";

describe("injectPonytail", () => {
  it("prepends a system message on OpenAI chat bodies", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
    };
    injectPonytail(body, FORMATS.OPENAI, "full");
    const messages = body.messages as Array<{ role?: string; content?: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toMatch(/lazy senior developer/i);
    expect(messages[0]?.content).toMatch(/Full:/);
    expect(messages[1]?.content).toBe("hi");
  });

  it("appends to Claude system string", () => {
    const body: Record<string, unknown> = {
      system: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
    };
    injectPonytail(body, FORMATS.CLAUDE, "lite");
    expect(String(body.system)).toMatch(/You are helpful/);
    expect(String(body.system)).toMatch(/Lite:/);
    expect(String(body.system)).toMatch(/lazy senior developer/i);
  });

  it("pushes a Gemini systemInstruction part", () => {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: "base" }] },
      contents: [],
    };
    injectPonytail(body, FORMATS.GEMINI, "ultra");
    const sys = body.systemInstruction as { parts: Array<{ text?: string }> };
    expect(sys.parts[0]?.text).toBe("base");
    expect(sys.parts[1]?.text).toMatch(/Ultra:/);
    expect(sys.parts[1]?.text).toMatch(/lazy senior developer/i);
  });

  it("no-ops on unknown levels", () => {
    const body: Record<string, unknown> = { messages: [{ role: "user", content: "hi" }] };
    injectPonytail(body, FORMATS.OPENAI, "nope");
    const messages = body.messages as Array<{ role?: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });
});
