/**
 * Combo Fusion: parallel panel (non-streaming, tools stripped) then a judge.
 * Typed rewrite of 9router Fusion — do not copy the JS.
 */

import { getCapabilitiesForModel, parseProviderModel } from "../providers/capabilities.ts";
import { extractTextContent } from "../translator/helpers/geminiHelper.ts";
import { detectRequiredCapabilities } from "./combo.ts";

const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

type JsonRecord = Record<string, unknown>;

type FusionLogger = {
  info: (scope: string, message: string, meta?: JsonRecord) => void;
  warn: (scope: string, message: string, meta?: JsonRecord) => void;
};

type FusionMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  [key: string]: unknown;
};

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  content?: unknown;
};

export type FusionTuning = {
  minPanel?: number;
  stragglerGraceMs?: number;
  panelHardTimeoutMs?: number;
};

export type FusionChatParams = {
  body: JsonRecord;
  models: string[];
  handleSingleModel: (body: JsonRecord, model: string, isPanel?: boolean) => Promise<Response>;
  log: FusionLogger;
  comboName?: string;
  judgeModel?: string;
  tuning?: FusionTuning;
};

export const FUSION_DEFAULTS: Required<FusionTuning> = {
  minPanel: 2,
  stragglerGraceMs: 8000,
  panelHardTimeoutMs: 90000,
};

type TimeoutMark = { __timeout: true };
type ErrorMark = { __error: unknown };
type PanelSlot = Response | TimeoutMark | ErrorMark | { ok?: boolean; status?: number };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTimeout(v: unknown): v is TimeoutMark {
  return !!v && typeof v === "object" && (v as TimeoutMark).__timeout === true;
}

function isErrorMark(v: unknown): v is ErrorMark {
  return !!v && typeof v === "object" && "__error" in v;
}

function isOkResult(v: unknown): v is { ok: true; clone: () => { json: () => Promise<unknown> } } {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { ok?: unknown }).ok === true &&
    typeof (v as { clone?: unknown }).clone === "function"
  );
}

export function filterCapablePanelModels(models: string[], body: JsonRecord): string[] {
  const required = detectRequiredCapabilities(body);
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  if (hard.length === 0) return models;
  return models.filter((m) => {
    const { provider, model } = parseProviderModel(m);
    const caps = getCapabilitiesForModel(provider, model) as unknown as Record<
      string,
      boolean | number | undefined
    >;
    return hard.every((c) => caps[c] === true);
  });
}

function flattenToolHistory(messages: unknown): FusionMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((msg) => msg)
    .map((msg: unknown) => {
      if (!msg || typeof msg !== "object") return msg as FusionMessage;
      const m = msg as FusionMessage;
      if (m.role === "tool" || m.role === "function") {
        return {
          role: "assistant",
          content: `${TOOL_RESULT_PREFIX}${extractTextContent(m.content) || String(m.content ?? "")}]`,
        };
      }
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        const { tool_calls, ...rest } = m;
        const names = tool_calls
          .map((c) => {
            if (!c || typeof c !== "object") return "tool";
            const rec = c as { function?: { name?: string }; name?: string };
            return rec.function?.name || rec.name || "tool";
          })
          .join(", ");
        const base =
          extractTextContent(rest.content) ||
          (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(m.content)) {
        const blocks = m.content as ContentBlock[];
        const hasToolUse = blocks.some((c) => c.type === "tool_use");
        const hasToolResult = blocks.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts: string[] = [];
          const toolNames: string[] = [];
          const toolResults: string[] = [];
          for (const block of blocks) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") {
              toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
            }
          }
          const { ...rest } = m;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return m;
    });
}

function extractPanelText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const rec = json as JsonRecord;

  const choices = rec.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const choice = choices[0] as JsonRecord;
    const msg =
      (choice.message && typeof choice.message === "object" ? choice.message : null) ||
      (choice.delta && typeof choice.delta === "object" ? choice.delta : null) ||
      {};
    const t = extractTextContent((msg as JsonRecord).content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  const claudeText = extractTextContent(rec.content);
  if (claudeText.trim()) return claudeText;

  const candidates = rec.candidates;
  if (Array.isArray(candidates) && candidates[0] && typeof candidates[0] === "object") {
    const content = (candidates[0] as JsonRecord).content;
    const parts =
      content && typeof content === "object" ? (content as JsonRecord).parts : undefined;
    if (Array.isArray(parts)) {
      const t = parts
        .map((p) => (p && typeof p === "object" ? String((p as JsonRecord).text || "") : ""))
        .join("");
      if (t.trim()) return t;
    }
  }

  if (Array.isArray(rec.output)) {
    const t = rec.output
      .flatMap((o) => {
        if (!o || typeof o !== "object") return [];
        const content = (o as JsonRecord).content;
        if (!Array.isArray(content)) return [];
        return content.map((c) =>
          c && typeof c === "object" ? String((c as JsonRecord).text || "") : "",
        );
      })
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

function appendUserTurn(body: JsonRecord, text: string): JsonRecord {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

function buildJudgePrompt(answers: { model: string; text: string }[]): string {
  const panel = answers.map((a, i) => `[Source ${i + 1}]\n${a.text}`).join("\n\n");
  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

function withTimeout(promise: Promise<Response>, ms: number): Promise<PanelSlot> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e: unknown) => {
        clearTimeout(t);
        resolve({ __error: e });
      });
  });
}

function collectPanel(
  calls: Promise<PanelSlot>[],
  {
    minPanel,
    stragglerGraceMs,
    panelHardTimeoutMs,
  }: { minPanel: number; stragglerGraceMs: number; panelHardTimeoutMs: number },
): Promise<(PanelSlot | undefined)[]> {
  return new Promise((resolve) => {
    const out: (PanelSlot | undefined)[] = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => {
          out[i] = v;
        })
        .catch((e: unknown) => {
          out[i] = { __error: e };
        })
        .finally(() => {
          settled++;
          const slot = out[i];
          if (slot && typeof slot === "object" && (slot as { ok?: unknown }).ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

export async function handleFusionChat({
  body,
  models,
  handleSingleModel,
  log,
  comboName,
  judgeModel,
  tuning,
}: FusionChatParams): Promise<Response> {
  const rawPanel = Array.isArray(models) ? models.filter(Boolean) : [];
  const panel = filterCapablePanelModels(rawPanel, body);
  if (panel.length === 0) {
    return new Response(JSON.stringify({ error: { message: "Fusion combo has no models" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]!);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0]!;
  log.info(
    "FUSION",
    `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`,
  );

  const { tools: _tools, tool_choice: _toolChoice, stream_options: _streamOptions, ...rest } = body;
  const panelBody: JsonRecord = { ...rest, stream: false };
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) =>
    withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs),
  );
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  const answers: { model: string; text: string }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i]!;
    if (!res) {
      log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`);
      continue;
    }
    if (isTimeout(res)) {
      log.warn("FUSION", `Panel ${model} timed out`);
      continue;
    }
    if (isErrorMark(res)) {
      log.warn("FUSION", `Panel ${model} threw`, { error: errorMessage(res.__error) });
      continue;
    }
    if (!isOkResult(res)) {
      const status =
        typeof (res as { status?: unknown }).status === "number"
          ? (res as { status: number }).status
          : 0;
      log.warn("FUSION", `Panel ${model} failed`, { status });
      continue;
    }
    try {
      const json: unknown = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e: unknown) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: errorMessage(e) });
    }
  }

  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(JSON.stringify({ error: { message: "All fusion panel models failed" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0]!.model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0]!.model);
  }

  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
