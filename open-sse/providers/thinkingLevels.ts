import { getCapabilitiesForModel } from "./capabilities.ts";

const L = {
  base: ["none", "low", "medium", "high"],
  onOff: ["none", "thinking"],
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],
  levelMax: ["none", "low", "medium", "high", "max"],
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],
  gemini: ["minimal", "low", "medium", "high"],
  hiMax: ["none", "high", "max"],
};

const FORMAT_LEVELS: Record<string, string[]> = {
  openai: L.openai,
  "claude-adaptive": L.levelMax,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

const PATTERN_THINKING: { provider?: string; pattern: string; re: RegExp; levels: string[] }[] = [
  {
    provider: "codex",
    pattern: "*gpt-5.6-sol*",
    re: globToRegExp("*gpt-5.6-sol*"),
    levels: [...CODEX_GPT_5_6_LEVELS, "ultra"],
  },
  {
    provider: "codex",
    pattern: "*gpt-5.6-terra*",
    re: globToRegExp("*gpt-5.6-terra*"),
    levels: [...CODEX_GPT_5_6_LEVELS, "ultra"],
  },
  {
    provider: "codex",
    pattern: "*gpt-5.6-luna*",
    re: globToRegExp("*gpt-5.6-luna*"),
    levels: CODEX_GPT_5_6_LEVELS,
  },
  { pattern: "*codex*", re: globToRegExp("*codex*"), levels: ["low", "medium", "high", "xhigh"] },
];

/** Valid copy-suffix levels, or null when the model has no reasoning. */
export function getThinkingLevels(provider: string, model: string): string[] | null {
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const hit = PATTERN_THINKING.find(
    (entry) => (!entry.provider || entry.provider === provider) && entry.re.test(model),
  );
  let levels = hit?.levels || FORMAT_LEVELS[caps.thinkingFormat || ""] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
