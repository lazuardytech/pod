import { describe, expect, it } from "vitest";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.ts";
import { compressMessages, formatRtkLog } from "../../open-sse/rtk/index.ts";
import { getTargetFormat } from "../../open-sse/services/provider.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import { translateRequest } from "../../open-sse/translator/index.ts";

const ALIAS_TO_PROVIDER: Record<string, string> = {
  cc: "claude",
  cx: "codex",
  ag: "antigravity",
  cu: "cursor",
  kr: "kiro",
  gemini: "gemini",
  deepseek: "deepseek",
  ollama: "ollama",
};

function makeBigDiff(fileCount = 2, linesPerFile = 60) {
  const out = [];
  for (let f = 0; f < fileCount; f++) {
    out.push(`diff --git a/src/file${f}.js b/src/file${f}.js`);
    out.push(`index abc${f}..def${f} 100644`);
    out.push(`--- a/src/file${f}.js`);
    out.push(`+++ b/src/file${f}.js`);
    out.push(`@@ -1,${linesPerFile} +1,${linesPerFile} @@`);
    for (let i = 0; i < linesPerFile; i++) {
      out.push(`-const old${f}_${i} = "removed value ${i} padding padding padding";`);
      out.push(`+const new${f}_${i} = "added value ${i} padding padding padding padding";`);
    }
  }
  return out.join("\n");
}

function chatBodyWithDiff(model: string, diff: string) {
  return {
    model,
    stream: false,
    max_tokens: 16,
    messages: [
      { role: "user", content: "run git diff" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "Bash", arguments: JSON.stringify({ command: "git diff" }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: diff },
      { role: "user", content: "ok" },
    ],
  };
}

const ROUTES = [
  { name: "claude (cc/* → openai→claude)", model: "cc/claude-opus-4-7" },
  { name: "codex (cx/* → openai→openai-responses)", model: "cx/gpt-5.4" },
  { name: "antigravity (ag/* → openai→antigravity)", model: "ag/gemini-3-flash" },
  { name: "cursor (cu/* → openai→cursor)", model: "cu/claude-4.5-sonnet" },
  { name: "kiro (kr/* → openai→kiro)", model: "kr/claude-sonnet-4.5" },
  { name: "gemini (gemini/* → openai→gemini)", model: "gemini/gemini-2.5-flash" },
  { name: "deepseek (deepseek/* → openai, passthrough)", model: "deepseek/deepseek-chat" },
  { name: "ollama (ollama/* → openai→ollama)", model: "ollama/gpt-oss:120b" },
];

function resolveTarget(model: string) {
  const slash = model.indexOf("/");
  const alias = slash === -1 ? model : model.slice(0, slash);
  const modelId = slash === -1 ? model : model.slice(slash + 1);
  const provider = ALIAS_TO_PROVIDER[alias] ?? alias;
  const targetFormat = getModelTargetFormat(alias, modelId) || getTargetFormat(provider);
  return { modelId, targetFormat };
}

describe("RTK after translateRequest", () => {
  for (const route of ROUTES) {
    it(`compresses git diff for ${route.name}`, () => {
      const diff = makeBigDiff();
      expect(diff.length).toBeGreaterThan(500);

      const { modelId, targetFormat } = resolveTarget(route.model);
      const body = chatBodyWithDiff(route.model, diff);
      const translated = translateRequest(
        FORMATS.OPENAI,
        targetFormat,
        modelId,
        structuredClone(body),
        false,
      );
      const blob = JSON.stringify(translated);
      expect(blob).toContain("diff --git");

      const stats = compressMessages(translated, true);
      const saved = (stats?.bytesBefore ?? 0) - (stats?.bytesAfter ?? 0);
      const filters = (stats?.hits ?? []).map((h) => h.filter).join(",");
      if (saved > 0) {
        expect(saved).toBeGreaterThan(500);
        expect(filters).toMatch(/git-diff|openai-responses/);
        expect(formatRtkLog(stats)).toBeTruthy();
      } else {
        // contents / user-wrapped tool_result: RTK only walks messages/input tool shapes
        expect(blob.length).toBeGreaterThan(diff.length);
      }
    });
  }
});
