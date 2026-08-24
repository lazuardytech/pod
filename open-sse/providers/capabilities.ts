/**
 * Model capability resolver for Vision Adapter.
 * models.dev modalities (if registered) → glob patterns for common families → all-false.
 * Not a dump of 9router's static catalog.
 */

export type ModelCapabilities = {
  vision: boolean;
  pdf: boolean;
  audioInput: boolean;
  videoInput: boolean;
  contextWindow?: number;
  reasoning?: boolean;
  thinkingFormat?: string;
  thinkingCanDisable?: boolean;
  thinkingRange?: { min?: number; max?: number };
  maxOutput?: number;
};

export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: false,
  pdf: false,
  audioInput: false,
  videoInput: false,
  reasoning: false,
  thinkingCanDisable: true,
};

type PatternCap = { re: RegExp; caps: Partial<ModelCapabilities> };

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function pat(pattern: string, caps: Partial<ModelCapabilities>): PatternCap {
  return { re: globToRegExp(pattern), caps };
}

// More specific patterns first. Vision/audio/pdf only.
const PATTERN_CAPS: PatternCap[] = [
  pat("*claude*haiku*3*", { vision: true }),
  pat("*claude*", { vision: true, pdf: true }),
  pat("*gemini*image*", { vision: true }),
  pat("*gemini*", { vision: true, audioInput: true, videoInput: true }),
  pat("*gemma*", { vision: true }),
  pat("*gpt-5*image*", {}),
  pat("*gpt-5*codex*", {}),
  pat("*gpt-5*", { vision: true }),
  pat("*gpt-4o*", { vision: true }),
  pat("*gpt-4.1*", { vision: true }),
  pat("*gpt-4-turbo*", { vision: true }),
  pat("*gpt-4-vision*", { vision: true }),
  pat("*o1-mini*", {}),
  pat("*o1*", { vision: true }),
  pat("*o3*", { vision: true }),
  pat("*o4*", { vision: true }),
  pat("*grok*image*", {}),
  pat("*grok-code*", {}),
  pat("*grok*", { vision: true }),
  pat("*qwen*vl*", { vision: true }),
  pat("*qwen*omni*", { vision: true, audioInput: true, videoInput: true }),
  pat("*qwen*coder*", {}),
  pat("*qwen*max*", {}),
  pat("*qwen3.5*", { vision: true, videoInput: true }),
  pat("*qwen3.6*", { vision: true, videoInput: true }),
  pat("*qwen3.7*", { vision: true, videoInput: true }),
  pat("*qwen*plus*", { vision: true }),
  pat("*kimi*k3*", { vision: true, videoInput: true }),
  pat("*kimi*for-coding*", { vision: true, videoInput: true }),
  pat("*kimi*k2.7*code*", { vision: true, videoInput: true }),
  pat("*kimi*k2*", { vision: true }),
  pat("*minimax*image*", {}),
  pat("*minimax-m3*", { vision: true }),
  pat("*mimo*v2.5*", { vision: true, audioInput: true, videoInput: true }),
  pat("*mimo*omni*", { vision: true, audioInput: true }),
  pat("*mimo*", { vision: true }),
  pat("*llama-4*", { vision: true }),
  pat("*mistral-large*", { vision: true }),
  pat("*command-a-vision*", { vision: true }),
  pat("*llava*", { vision: true }),
  pat("*pixtral*", { vision: true }),
  pat("*deepseek*", {}),
];

// Thinking overlay — first match wins. Specific families before generics.
const THINKING_PATTERN_CAPS: PatternCap[] = [
  pat("*claude*opus-5*", { reasoning: true, thinkingFormat: "claude-adaptive", maxOutput: 128000 }),
  pat("*claude*opus-4.6*", { reasoning: true, thinkingFormat: "claude-adaptive" }),
  pat("*claude*opus-4.7*", { reasoning: true, thinkingFormat: "claude-adaptive" }),
  pat("*claude*opus-4.8*", { reasoning: true, thinkingFormat: "claude-adaptive" }),
  pat("*claude*sonnet-4.6*", { reasoning: true, thinkingFormat: "claude-adaptive" }),
  pat("*claude*sonnet-4.7*", { reasoning: true, thinkingFormat: "claude-adaptive" }),
  pat("*claude*haiku*", { reasoning: true, thinkingFormat: "claude-budget" }),
  pat("*claude*opus*", { reasoning: true, thinkingFormat: "claude-budget" }),
  pat("*claude*sonnet*", { reasoning: true, thinkingFormat: "claude-budget" }),
  pat("*claude-3*", {}),
  pat("*claude*", { reasoning: true, thinkingFormat: "claude-budget" }),
  pat("*gemini*image*", {}),
  pat("*gemini-3.7*", {
    reasoning: true,
    thinkingFormat: "gemini-level",
    thinkingCanDisable: false,
    maxOutput: 65536,
  }),
  pat("*gemini-3*pro*", {
    reasoning: true,
    thinkingFormat: "gemini-level",
    thinkingCanDisable: false,
    maxOutput: 65535,
  }),
  pat("*gemini-3*", {
    reasoning: true,
    thinkingFormat: "gemini-level",
    thinkingCanDisable: false,
    maxOutput: 65536,
  }),
  pat("*gemini-2.5*", {
    reasoning: true,
    thinkingFormat: "gemini-budget",
    thinkingRange: { min: 0, max: 24576 },
    maxOutput: 65536,
  }),
  pat("*gpt-5*image*", {}),
  pat("*gpt-5*codex*", { reasoning: true, thinkingFormat: "openai", maxOutput: 128000 }),
  pat("*gpt-5*", { reasoning: true, thinkingFormat: "openai", maxOutput: 128000 }),
  pat("*gpt-4o*", {}),
  pat("*o1-mini*", { reasoning: true, thinkingFormat: "openai" }),
  pat("*o1*", { reasoning: true, thinkingFormat: "openai" }),
  pat("*o3*", { reasoning: true, thinkingFormat: "openai" }),
  pat("*o4*", { reasoning: true, thinkingFormat: "openai" }),
  pat("*qwen*vl*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwen*omni*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwen*coder*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwen*max*", { reasoning: true, thinkingFormat: "qwen", maxOutput: 65536 }),
  pat("*qwen3.5*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwen3.6*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwen3.7*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwen*plus*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*qwq*", { reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false }),
  pat("*qwen*", { reasoning: true, thinkingFormat: "qwen" }),
  pat("*kimi*k3*", { reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false }),
  pat("*kimi*for-coding*", { reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false }),
  pat("*kimi*k2.7*code*", { reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false }),
  pat("*kimi*k2*", { reasoning: true, thinkingFormat: "kimi" }),
  pat("*kimi*", { reasoning: true, thinkingFormat: "kimi" }),
  pat("*glm-5*", { reasoning: true, thinkingFormat: "zai" }),
  pat("*glm-4.7*", { reasoning: true, thinkingFormat: "zai" }),
  pat("*glm-4*", { reasoning: true, thinkingFormat: "zai" }),
  pat("*glm*", { reasoning: true, thinkingFormat: "zai" }),
  pat("*deepseek-v4*", { reasoning: true, thinkingFormat: "deepseek" }),
  pat("*deepseek-chat*", {}),
  pat("*deepseek-r*", { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false }),
  pat("*deepseek*", { reasoning: true, thinkingFormat: "deepseek" }),
  pat("*minimax-m3*", { reasoning: true, thinkingFormat: "minimax" }),
  pat("*minimax-m2.7*", { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false }),
  pat("*minimax*", { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false }),
  pat("*hunyuan*", { reasoning: true, thinkingFormat: "hunyuan" }),
  pat("hy3*", { reasoning: true, thinkingFormat: "hunyuan" }),
  pat("*step-*", { reasoning: true, thinkingFormat: "step" }),
];

let modelsDevModalities: Record<string, Record<string, Partial<ModelCapabilities>>> = {};

export function registerModelsDevModalities(
  map: Record<string, Record<string, Partial<ModelCapabilities>>>,
): void {
  modelsDevModalities = map;
}

export function getRegisteredModelsDevModalities(): Record<
  string,
  Record<string, Partial<ModelCapabilities>>
> {
  return modelsDevModalities;
}

function lookupModelsDev(provider: string, model: string): Partial<ModelCapabilities> | null {
  const p = provider.toLowerCase();
  const m = model.toLowerCase();
  const byProvider = modelsDevModalities[p]?.[model] ?? modelsDevModalities[p]?.[m];
  if (byProvider) return byProvider;
  for (const models of Object.values(modelsDevModalities)) {
    if (models[model]) return models[model];
    if (models[m]) return models[m];
  }
  return null;
}

function matchPatterns(id: string, table: PatternCap[]): Partial<ModelCapabilities> | null {
  for (const { re, caps } of table) {
    if (re.test(id)) return caps;
  }
  return null;
}

function matchVision(id: string): Partial<ModelCapabilities> | null {
  return matchPatterns(id, PATTERN_CAPS);
}

function matchThinking(id: string): Partial<ModelCapabilities> | null {
  return matchPatterns(id, THINKING_PATTERN_CAPS);
}

export function getCapabilitiesForModel(provider: string, model: string): ModelCapabilities {
  const fromDev = lookupModelsDev(provider || "", model || "");
  const fromThinking =
    matchThinking(model) || matchThinking(provider ? `${provider}/${model}` : model);
  if (fromDev) return { ...DEFAULT_CAPABILITIES, ...fromDev, ...fromThinking };
  const fromVision = matchVision(model) || matchVision(provider ? `${provider}/${model}` : model);
  return { ...DEFAULT_CAPABILITIES, ...fromVision, ...fromThinking };
}

export function parseProviderModel(modelStr: string): { provider: string; model: string } {
  const slash = typeof modelStr === "string" ? modelStr.indexOf("/") : -1;
  if (slash <= 0) return { provider: "", model: modelStr || "" };
  return { provider: modelStr.slice(0, slash), model: modelStr.slice(slash + 1) };
}

export function getCapabilitiesForModelStr(modelStr: string): ModelCapabilities {
  const { provider, model } = parseProviderModel(modelStr);
  return getCapabilitiesForModel(provider, model);
}
