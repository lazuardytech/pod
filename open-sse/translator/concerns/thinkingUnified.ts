import { getCapabilitiesForModel } from "../../providers/capabilities.ts";
import { getThinkingLevels } from "../../providers/thinkingLevels.ts";
import {
  budgetToLevel,
  effortToBudget,
  effortToThinkingLevel,
  LEVEL_TO_BUDGET,
} from "./thinking.ts";

export type ThinkingIntent =
  | { mode: "none" }
  | { mode: "auto" }
  | { mode: "level"; level: string }
  | { mode: "budget"; budget: number };

type ThinkingWireFormat =
  | "openai"
  | "claude-adaptive"
  | "claude-budget"
  | "gemini-level"
  | "gemini-budget"
  | "zai"
  | "qwen"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "hunyuan"
  | "step"
  | "tokenrouter"
  | "kiro";

const FORMAT_TO_NATIVE: Record<string, ThinkingWireFormat> = {
  openai: "openai",
  "openai-responses": "openai",
  "openai-response": "openai",
  codex: "openai",
  claude: "claude-budget",
  gemini: "gemini-budget",
  "gemini-cli": "gemini-budget",
  vertex: "gemini-budget",
  antigravity: "gemini-budget",
  kiro: "kiro",
};

const PROVIDER_THINKING_FORMAT: Record<string, ThinkingWireFormat> = {
  siliconflow: "openai",
};

const WIRE_FORMATS = new Set<string>([
  "openai",
  "claude-adaptive",
  "claude-budget",
  "gemini-level",
  "gemini-budget",
  "zai",
  "qwen",
  "deepseek",
  "kimi",
  "minimax",
  "hunyuan",
  "step",
  "tokenrouter",
  "kiro",
]);

const GEMINI_LEVEL_OUTPUT_FLOOR: Record<string, number> = {
  minimal: 4096,
  low: 8192,
  medium: 16384,
  high: 65535,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function isWireFormat(value: string): value is ThinkingWireFormat {
  return WIRE_FORMATS.has(value);
}

export function stripThinkingSuffix(model: unknown): unknown {
  if (typeof model !== "string") return model;
  const match = model.match(/^(.*)\([^()]+\)\s*$/);
  return match?.[1] ? match[1].trim() : model;
}

export function parseSuffix(model: unknown): {
  cleanModel: unknown;
  override: ThinkingIntent | null;
} {
  if (typeof model !== "string") return { cleanModel: model, override: null };
  const match = model.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!match?.[1] || match[2] === undefined) return { cleanModel: model, override: null };
  const cleanModel = match[1].trim();
  const raw = match[2].trim().toLowerCase();
  if (raw === "none" || raw === "off") return { cleanModel, override: { mode: "none" } };
  if (raw === "auto") return { cleanModel, override: { mode: "auto" } };
  if (raw === "ultra") return { cleanModel, override: { mode: "level", level: raw } };
  if (/^\d+$/.test(raw)) return { cleanModel, override: { mode: "budget", budget: Number(raw) } };
  if (LEVEL_TO_BUDGET[raw] !== undefined) {
    return { cleanModel, override: { mode: "level", level: raw } };
  }
  return { cleanModel, override: null };
}

export function extractThinking(body: unknown): ThinkingIntent | null {
  const rec = asRecord(body);
  if (!rec) return null;

  const oc = asRecord(rec.output_config)?.effort;
  if (typeof oc === "string" && oc) {
    const e = oc.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  const thinking = asRecord(rec.thinking);
  if (thinking) {
    if (thinking.type === "disabled") return { mode: "none" };
    if (thinking.type === "adaptive" || thinking.type === "enabled") {
      const budget = Number(thinking.budget_tokens);
      if (Number.isFinite(budget) && budget > 0) return { mode: "budget", budget };
      return { mode: "auto" };
    }
  }

  const reasoning = asRecord(rec.reasoning);
  const effort = rec.reasoning_effort ?? reasoning?.effort;
  if (typeof effort === "string" && effort) {
    const e = effort.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  const generationConfig = asRecord(rec.generationConfig);
  const request = asRecord(rec.request);
  const requestGc = asRecord(request?.generationConfig);
  const tc =
    asRecord(rec.thinkingConfig) ||
    asRecord(generationConfig?.thinkingConfig) ||
    asRecord(requestGc?.thinkingConfig);
  if (tc) {
    if (typeof tc.thinkingLevel === "string") {
      return { mode: "level", level: tc.thinkingLevel.toLowerCase() };
    }
    const tb = Number(tc.thinkingBudget);
    if (Number.isFinite(tb)) {
      if (tb === 0) return { mode: "none" };
      if (tb < 0) return { mode: "auto" };
      return { mode: "budget", budget: tb };
    }
  }

  if (rec.enable_thinking === false) return { mode: "none" };
  if (rec.enable_thinking === true) {
    const tb = Number(rec.thinking_budget);
    if (Number.isFinite(tb) && tb > 0) return { mode: "budget", budget: tb };
    return { mode: "auto" };
  }

  return null;
}

export const captureThinking = extractThinking;

function resolveFormat(
  targetFormat: string,
  model: string,
  provider: string | null,
): ThinkingWireFormat {
  if (provider) {
    const forced = PROVIDER_THINKING_FORMAT[provider];
    if (forced) return forced;
  }
  const caps = getCapabilitiesForModel(provider || "", model);
  if (caps.thinkingFormat && isWireFormat(caps.thinkingFormat)) return caps.thinkingFormat;
  return FORMAT_TO_NATIVE[targetFormat] || "openai";
}

function toBudget(cfg: ThinkingIntent, range?: { min?: number; max?: number }): number | undefined {
  let budget: number | undefined;
  if (cfg.mode === "budget") budget = cfg.budget;
  else if (cfg.mode === "level") budget = effortToBudget(cfg.level);
  else if (cfg.mode === "auto") return -1;
  if (typeof budget !== "number" || !Number.isFinite(budget)) return undefined;
  if (range) {
    if (range.min !== undefined && budget < range.min) budget = range.min;
    if (range.max !== undefined && budget > range.max) budget = range.max;
  }
  return budget;
}

function toLevel(cfg: ThinkingIntent): string | null {
  if (cfg.mode === "level") return cfg.level;
  if (cfg.mode === "budget") return budgetToLevel(cfg.budget) || "medium";
  if (cfg.mode === "auto") return "auto";
  return null;
}

function normalizeOpenAILevel(level: string, supportedLevels: string[] | null): string {
  if (level !== "max" && level !== "ultra") return level;
  if (supportedLevels?.includes(level)) return level;
  if (level === "ultra" && supportedLevels?.includes("max")) return "max";
  return "xhigh";
}

function toGeminiThinkingLevel(cfg: ThinkingIntent): string {
  const raw = cfg.mode === "auto" ? "high" : toLevel(cfg) || "high";
  return effortToThinkingLevel(raw);
}

function toKimiReasoningEffort(cfg: ThinkingIntent): string | null {
  const level = toLevel(cfg);
  if (level === "auto") return "high";
  if (level === "minimal") return "low";
  if (level === "xhigh") return "max";
  if (level && ["low", "medium", "high", "max"].includes(level)) return level;
  return null;
}

function geminiBudgetOutputFloor(budget: number): number {
  if (budget === -1) return 32768;
  if (!Number.isFinite(budget)) return 32768;
  if (budget <= 1024) return 8192;
  if (budget <= 8192) return 16384;
  if (budget <= 24576) return 32768;
  return 65535;
}

function geminiLevelOutputFloor(level: string): number {
  return GEMINI_LEVEL_OUTPUT_FLOOR[level] || GEMINI_LEVEL_OUTPUT_FLOOR.high || 65535;
}

function getGeminiGenerationConfig(body: Record<string, unknown>): Record<string, unknown> {
  const request = asRecord(body.request);
  if (request) {
    const gc = asRecord(request.generationConfig) || {};
    request.generationConfig = gc;
    body.request = request;
    return gc;
  }
  const gc = asRecord(body.generationConfig) || {};
  body.generationConfig = gc;
  return gc;
}

function setGeminiThinking(body: Record<string, unknown>, tc: Record<string, unknown>): void {
  getGeminiGenerationConfig(body).thinkingConfig = tc;
}

function ensureGeminiOutputFloor(
  body: Record<string, unknown>,
  floor: number,
  caps: { maxOutput?: number },
): void {
  const cap = Number.isFinite(caps.maxOutput) ? (caps.maxOutput as number) : floor;
  const target = Math.min(floor, cap);
  const gc = getGeminiGenerationConfig(body);
  const current = Number(gc.maxOutputTokens);
  if (!Number.isFinite(current) || current < target) gc.maxOutputTokens = target;
}

function stripAll(body: Record<string, unknown>): void {
  delete body.thinking;
  delete body.reasoning_effort;
  delete body.reasoning;
  delete body.thinkingConfig;
  delete body.enable_thinking;
  delete body.thinking_budget;
  delete body.output_config;
  const gc = asRecord(body.generationConfig);
  if (gc) delete gc.thinkingConfig;
  const request = asRecord(body.request);
  const requestGc = asRecord(request?.generationConfig);
  if (requestGc) delete requestGc.thinkingConfig;
}

function applyFormat(
  fmt: ThinkingWireFormat,
  body: Record<string, unknown>,
  cfg: ThinkingIntent,
  caps: ReturnType<typeof getCapabilitiesForModel>,
  supportedLevels: string[] | null,
): void {
  const none = cfg.mode === "none";
  const canDisable = caps.thinkingCanDisable !== false;
  const eff: ThinkingIntent = none && !canDisable ? { mode: "level", level: "minimal" } : cfg;

  switch (fmt) {
    case "openai": {
      if (none && canDisable) {
        body.reasoning_effort = "none";
        break;
      }
      const level = toLevel(eff);
      if (level) body.reasoning_effort = normalizeOpenAILevel(level, supportedLevels);
      break;
    }
    case "claude-adaptive": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      body.thinking = { type: "adaptive" };
      const level = toLevel(eff);
      body.output_config = { effort: level === "xhigh" ? "high" : level };
      break;
    }
    case "claude-budget": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      const budget = toBudget(eff, caps.thinkingRange);
      body.thinking =
        budget === -1 ? { type: "enabled" } : { type: "enabled", budget_tokens: budget || 8192 };
      break;
    }
    case "gemini-level": {
      const level = none ? "minimal" : toGeminiThinkingLevel(eff);
      setGeminiThinking(body, { thinkingLevel: level, includeThoughts: level !== "minimal" });
      ensureGeminiOutputFloor(body, geminiLevelOutputFloor(level), caps);
      break;
    }
    case "gemini-budget": {
      if (none && canDisable) {
        setGeminiThinking(body, { thinkingBudget: 0, includeThoughts: false });
        break;
      }
      const budget = toBudget(eff, caps.thinkingRange);
      setGeminiThinking(body, { thinkingBudget: budget ?? -1, includeThoughts: true });
      ensureGeminiOutputFloor(body, geminiBudgetOutputFloor(budget ?? -1), caps);
      break;
    }
    case "zai": {
      if (none && canDisable) {
        body.enable_thinking = false;
        delete body.thinking;
        break;
      }
      body.thinking = { type: "enabled" };
      break;
    }
    case "qwen": {
      if (none && canDisable) {
        body.enable_thinking = false;
        break;
      }
      body.enable_thinking = true;
      const budget = toBudget(eff, caps.thinkingRange);
      if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
        body.thinking_budget = budget;
      }
      break;
    }
    case "deepseek": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      body.thinking = { type: "enabled" };
      const level = toLevel(eff);
      body.reasoning_effort = level === "xhigh" || level === "max" ? "max" : "high";
      break;
    }
    case "kimi": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      const effort = toKimiReasoningEffort(eff);
      if (effort) body.reasoning_effort = effort;
      break;
    }
    case "minimax": {
      body.thinking = { type: none && canDisable ? "disabled" : "adaptive" };
      break;
    }
    case "hunyuan": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      const budget = toBudget(eff, caps.thinkingRange);
      body.thinking =
        budget === -1 ? { type: "enabled" } : { type: "enabled", budget_tokens: budget || 8192 };
      break;
    }
    case "step": {
      if (none && canDisable) break;
      const level = toLevel(eff);
      if (level) body.reasoning_effort = level === "xhigh" || level === "max" ? "high" : level;
      break;
    }
    case "tokenrouter": {
      if (none || eff.mode === "auto") break;
      const level = toLevel(eff);
      if (level) body.reasoning_effort = level;
      break;
    }
    case "kiro":
      break;
    default: {
      const _exhaustive: never = fmt;
      void _exhaustive;
      break;
    }
  }
}

export function applyThinking(
  targetFormat: string,
  model: unknown,
  body: unknown,
  provider: string | null = null,
  intent: ThinkingIntent | null | undefined = undefined,
): unknown {
  const rec = asRecord(body);
  if (!rec) return body;

  const { cleanModel, override } = parseSuffix(model);
  const cfg = override || intent || extractThinking(rec);
  const caps = getCapabilitiesForModel(
    provider || "",
    typeof cleanModel === "string" ? cleanModel : String(model ?? ""),
  );

  if (!caps.reasoning) {
    stripAll(rec);
    return rec;
  }
  if (!cfg) return rec;

  const modelId = typeof cleanModel === "string" ? cleanModel : String(model ?? "");
  const fmt = resolveFormat(targetFormat, modelId, provider);
  const supportedLevels = getThinkingLevels(provider || "", modelId);
  stripAll(rec);
  applyFormat(fmt, rec, cfg, caps, supportedLevels);
  return rec;
}
