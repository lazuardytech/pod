import { describe, expect, it, vi } from "vitest";

import { coerceNonChatComboStrategy } from "../../open-sse/services/combo.ts";
import { handleFusionChat } from "../../open-sse/services/fusion.ts";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

const DEEPSEEK = "ds/deepseek-chat";
const CLAUDE = "anthropic/claude-sonnet-4";

function okResponse(content: string, { delayMs = 0 }: { delayMs?: number } = {}) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  const res = make();
  return delayMs > 0 ? new Promise((r) => setTimeout(() => r(res), delayMs)) : res;
}

function errResponse(status = 500) {
  const make = () => ({
    ok: false,
    status,
    clone: make,
    json: async () => ({ error: { message: "boom" } }),
  });
  return make();
}

describe("fusion combo", () => {
  it("answers directly with a single-model panel (nothing to fuse)", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("solo"));
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/only"],
      handleSingleModel,
      log,
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel.mock.calls[0]?.[1]).toBe("p/only");
  });

  it("fans out to the panel then routes a synthesis turn to the judge", async () => {
    const seen: string[] = [];
    const handleSingleModel = vi.fn(async (_body, model: string) => {
      seen.push(model);
      if (model === "p/judge") return okResponse("FINAL");
      return okResponse(`ans-${model}`);
    });

    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }], stream: true, tools: [{ name: "x" }] },
      models: ["p/a", "p/b", "p/c"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    expect(handleSingleModel).toHaveBeenCalledTimes(4);
    expect(seen.slice(0, 3).sort()).toEqual(["p/a", "p/b", "p/c"]);
    expect(seen[3]).toBe("p/judge");

    for (const [body, model, isPanel] of handleSingleModel.mock.calls.filter(
      ([, m]) => m !== "p/judge",
    )) {
      expect((body as { stream?: boolean }).stream).toBe(false);
      expect((body as { tools?: unknown }).tools).toBeUndefined();
      expect(isPanel).toBe(true);
      void model;
    }

    const judgeCall = handleSingleModel.mock.calls.find(([, m]) => m === "p/judge");
    expect(judgeCall).toBeDefined();
    const judgeBody = judgeCall![0] as {
      messages: { content: string }[];
      stream?: boolean;
    };
    const judgeText = judgeBody.messages.at(-1)?.content;
    expect(judgeText).toContain("ans-p/a");
    expect(judgeText).toContain("ans-p/b");
    expect(judgeText).toContain("ans-p/c");
    expect(judgeText).toContain("Source 1");
    expect(judgeBody.stream).toBe(true);
    expect(judgeCall?.[2]).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it("defaults the judge to the first panel model when none is set", async () => {
    const seen: string[] = [];
    const handleSingleModel = vi.fn(async (_body, model: string) => {
      seen.push(model);
      return okResponse(`ans-${model}`);
    });
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/first", "p/second"],
      handleSingleModel,
      log,
    });
    expect(seen.at(-1)).toBe("p/first");
  });

  it("proceeds on quorum without waiting for a straggler (grace window)", async () => {
    const handleSingleModel = vi.fn(async (_body, model: string) => {
      if (model === "p/slow") return okResponse("slow", { delayMs: 5000 });
      if (model === "p/judge") return okResponse("FINAL");
      return okResponse(`fast-${model}`);
    });

    const t0 = Date.now();
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/x", "p/y", "p/slow"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 10000 },
    });
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(2000);

    const judgeCall = handleSingleModel.mock.calls.find(([, m]) => m === "p/judge");
    expect(judgeCall).toBeDefined();
    const judgeText = (judgeCall![0] as { messages: { content: string }[] }).messages.at(
      -1,
    )?.content;
    expect(judgeText).toContain("fast-p/x");
    expect(judgeText).toContain("fast-p/y");
    expect(judgeText).not.toContain("slow");
  });

  it("returns the lone survivor directly when only one panel model succeeds", async () => {
    const handleSingleModel = vi.fn(async (_body: Record<string, unknown>, model: string) => {
      if (model === "p/ok") return okResponse("lone");
      return errResponse(500);
    });
    await handleFusionChat({
      body: {
        messages: [{ role: "user", content: "Q" }],
        tools: [{ name: "x" }],
        stream: true,
      },
      models: ["p/ok", "p/bad"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });
    const judged = handleSingleModel.mock.calls.some(([, m]) => m === "p/judge");
    expect(judged).toBe(false);
    const replay = handleSingleModel.mock.calls.find(
      ([, m, isPanel]) => m === "p/ok" && isPanel !== true,
    );
    expect(replay).toBeDefined();
    const replayBody = replay![0] as { tools?: unknown; stream?: boolean };
    expect(replayBody.tools).toEqual([{ name: "x" }]);
    expect(replayBody.stream).toBe(true);
  });

  it("returns 503 when the whole panel fails", async () => {
    const handleSingleModel = vi.fn(async () => errResponse(500));
    const res = await handleFusionChat({
      body: { messages: [{ role: "user", content: "Q" }] },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      tuning: { minPanel: 2, stragglerGraceMs: 50, panelHardTimeoutMs: 5000 },
    });
    expect(res.status).toBe(503);
  });

  it("strips tools, stream_options, and forces stream:false on panel calls", async () => {
    let capturedPanelBody: Record<string, unknown> | null = null;
    const handleSingleModel = vi.fn(async (panelBody: Record<string, unknown>, _model, isPanel) => {
      if (isPanel) capturedPanelBody = panelBody;
      return okResponse(isPanel ? `ans-${_model}` : "final");
    });

    await handleFusionChat({
      body: {
        model: "combo/x",
        stream: true,
        stream_options: { include_usage: true },
        tools: [{ type: "function" }],
        tool_choice: "auto",
        messages: [{ role: "user", content: "hi" }],
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    expect(capturedPanelBody).not.toBeNull();
    expect(capturedPanelBody?.stream_options).toBeUndefined();
    expect(capturedPanelBody?.tools).toBeUndefined();
    expect(capturedPanelBody?.tool_choice).toBeUndefined();
    expect(capturedPanelBody?.stream).toBe(false);
  });

  it("flattens previous tool history and assistant tool_calls into prose for panel calls", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "find files" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "c1", type: "function", function: { name: "find" } }],
          },
          { role: "tool", tool_call_id: "c1", content: "['a.js']" },
          { role: "user", content: "describe it" },
        ],
        tools: [{ type: "function" }],
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    const panelCalls = handleSingleModel.mock.calls.filter(([, , isPanel]) => isPanel === true);
    expect(panelCalls.length).toBe(2);
    for (const [panelBody] of panelCalls) {
      const body = panelBody as {
        tools?: unknown;
        messages: { role?: string; content?: unknown; tool_calls?: unknown }[];
      };
      expect(body.tools).toBeUndefined();
      expect(body.messages.length).toBe(4);
      expect(body.messages[0]).toEqual({ role: "user", content: "find files" });
      expect(body.messages[1]?.tool_calls).toBeUndefined();
      expect(String(body.messages[1]?.content)).toContain("find");
      expect(body.messages[2]?.role).toBe("assistant");
      expect(String(body.messages[2]?.content)).toContain("['a.js']");
      expect(body.messages[3]).toEqual({ role: "user", content: "describe it" });
    }

    const judgeCall = handleSingleModel.mock.calls.find(([, m]) => m === "p/judge");
    expect(judgeCall).toBeDefined();
    const judgeBody = judgeCall?.[0] as {
      messages: { role?: string; tool_calls?: unknown }[];
    };
    expect(judgeBody.messages.length).toBe(5);
    expect(judgeBody.messages[1]?.tool_calls).toBeDefined();
    expect(judgeBody.messages[2]?.role).toBe("tool");
  });

  it("flattens Anthropic-style tool_use and tool_result blocks in arrays", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("ans"));
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "do it" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "ok" },
              { type: "tool_use", id: "t1", name: "run" },
            ],
          },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
        ],
        tools: [{ name: "run", description: "d" }],
      },
      models: ["p/a", "p/b"],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });

    const panelCalls = handleSingleModel.mock.calls.filter(([, , isPanel]) => isPanel === true);
    expect(panelCalls.length).toBe(2);
    const panelBody = panelCalls[0]?.[0] as { messages: { content?: string }[] };
    expect(panelBody.messages[1]?.content).toBe("ok\n[Called tools: run]");
    expect(panelBody.messages[2]?.content).toBe("[Tool result: done]");
  });

  it("drops text-only panel members on a vision turn so they are not billed", async () => {
    const seen: string[] = [];
    const handleSingleModel = vi.fn(async (_body, model: string) => {
      seen.push(model);
      return okResponse(`ans-${model}`);
    });
    await handleFusionChat({
      body: {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }],
          },
        ],
      },
      models: [DEEPSEEK, CLAUDE],
      handleSingleModel,
      log,
      judgeModel: "p/judge",
    });
    expect(seen).toEqual([CLAUDE]);
    expect(seen).not.toContain(DEEPSEEK);
    const judged = handleSingleModel.mock.calls.some(([, m]) => m === "p/judge");
    expect(judged).toBe(false);
  });

  it("defaults the judge to the first capable member after the vision filter", async () => {
    const seen: string[] = [];
    const handleSingleModel = vi.fn(async (_body, model: string) => {
      seen.push(model);
      return okResponse(`ans-${model}`);
    });
    const GPT = "openai/gpt-4o";
    await handleFusionChat({
      body: {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }],
          },
        ],
      },
      models: [DEEPSEEK, CLAUDE, GPT],
      handleSingleModel,
      log,
    });
    expect(seen.slice(0, 2).sort()).toEqual([CLAUDE, GPT].sort());
    expect(seen).not.toContain(DEEPSEEK);
    expect(seen.at(-1)).toBe(CLAUDE);
  });
});

describe("non-chat fusion coerce", () => {
  it("maps fusion to fallback and leaves other strategies alone", () => {
    expect(coerceNonChatComboStrategy("fusion")).toBe("fallback");
    expect(coerceNonChatComboStrategy("round-robin")).toBe("round-robin");
    expect(coerceNonChatComboStrategy("fallback")).toBe("fallback");
    expect(coerceNonChatComboStrategy(undefined)).toBe("fallback");
  });
});
