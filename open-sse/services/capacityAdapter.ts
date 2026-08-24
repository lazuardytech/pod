/**
 * Capacity Adapter — global fallback pools of models per input-modality capability
 * (vision / pdf / audioInput / videoInput).
 *
 * Empty enabled pool = no-op (do not invent a default model). Adapter models are
 * prepended only when none of the original models can satisfy the hard caps.
 */

import { getCapabilitiesForModel } from "../providers/capabilities.ts";

export const CAPABILITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

const HARD_CAPS = new Set<string>(CAPABILITY_KEYS);

export type CapacityCapEntry = {
  enabled: boolean;
  roundRobin: boolean;
  models: string[];
};

export type CapacityAdapterSettings = {
  capacityAdapter?: Partial<Record<CapabilityKey, CapacityCapEntry | unknown>>;
  [key: string]: unknown;
};

const EMPTY_ENTRY: CapacityCapEntry = { enabled: false, roundRobin: false, models: [] };

export function normalizeCapEntry(entry: unknown): CapacityCapEntry {
  if (Array.isArray(entry)) {
    return {
      enabled: true,
      roundRobin: false,
      models: entry
        .map((e) => (typeof e === "string" ? e : (e as { model?: string })?.model))
        .filter((m): m is string => typeof m === "string" && !!m),
    };
  }
  if (entry && typeof entry === "object") {
    const rec = entry as { enabled?: unknown; roundRobin?: unknown; models?: unknown };
    return {
      enabled: rec.enabled !== false,
      roundRobin: !!rec.roundRobin,
      models: Array.isArray(rec.models)
        ? rec.models.filter((m): m is string => typeof m === "string" && !!m)
        : [],
    };
  }
  return { ...EMPTY_ENTRY };
}

export function getCapacityAdapterConfig(
  cap: string,
  settings: CapacityAdapterSettings | null | undefined,
): CapacityCapEntry {
  return normalizeCapEntry(settings?.capacityAdapter?.[cap as CapabilityKey]);
}

export function getCapacityAdapterModels(
  settings: CapacityAdapterSettings | null | undefined,
): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const cap of CAPABILITY_KEYS) {
    const { enabled, models: pool } = getCapacityAdapterConfig(cap, settings);
    if (!enabled) continue;
    for (const m of pool) {
      if (!seen.has(m)) {
        seen.add(m);
        models.push(m);
      }
    }
  }
  return models;
}

export function getCapacityAdapterStrategy(
  cap: string,
  settings: CapacityAdapterSettings | null | undefined,
): "round-robin" | "fallback" {
  const { enabled, roundRobin } = getCapacityAdapterConfig(cap, settings);
  return enabled && roundRobin ? "round-robin" : "fallback";
}

export function getActiveAdapterStrategy(
  requiredCapabilities: Iterable<string> | null | undefined,
  settings: CapacityAdapterSettings | null | undefined,
): "round-robin" | "fallback" {
  const hard = [...(requiredCapabilities || [])].filter((c) => HARD_CAPS.has(c));
  for (const cap of hard) {
    const { enabled, models } = getCapacityAdapterConfig(cap, settings);
    if (!enabled || models.length === 0) continue;
    return getCapacityAdapterStrategy(cap, settings);
  }
  return "fallback";
}

function modelSatisfies(modelStr: string, requiredHard: string[]) {
  const slash = modelStr.indexOf("/");
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
  const caps = getCapabilitiesForModel(provider, model) as unknown as Record<
    string,
    boolean | number | undefined
  >;
  return requiredHard.every((c) => caps[c] === true);
}

export function augmentModelsWithCapacityAdapter(
  models: string[],
  requiredCapabilities: Iterable<string> | null | undefined,
  settings: CapacityAdapterSettings | null | undefined,
): string[] {
  const hard = [...(requiredCapabilities || [])].filter((c) => HARD_CAPS.has(c));
  if (hard.length === 0 || !Array.isArray(models) || models.length === 0) return models;
  if (models.some((m) => modelSatisfies(m, hard))) return models;

  const pool = getCapacityAdapterModels(settings).filter(
    (m) => !models.includes(m) && modelSatisfies(m, hard),
  );
  if (pool.length === 0) return models;
  return [...pool, ...models];
}

const CHARS_PER_TOKEN = 4;
const HEAD_KEEP = 6;

function blockLength(content: unknown) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce(
      (sum, b) =>
        sum +
        (typeof (b as { text?: unknown })?.text === "string"
          ? (b as { text: string }).text.length
          : 50),
      0,
    );
  }
  return 0;
}

type JsonRecord = Record<string, unknown>;

type HistoryBody = JsonRecord & {
  messages?: unknown[];
  input?: unknown[];
  contents?: unknown[];
};

export function stripHistoryForContext(
  body: HistoryBody,
  contextWindow: number | undefined,
): HistoryBody {
  const key = Array.isArray(body.messages)
    ? "messages"
    : Array.isArray(body.input)
      ? "input"
      : Array.isArray(body.contents)
        ? "contents"
        : null;
  if (!key) return body;
  const arr = body[key];
  if (!arr || arr.length === 0) return body;

  const isSystem = (r: unknown) => r === "system" || r === "developer";
  const systemMsgs = arr.filter((m) => isSystem((m as { role?: unknown })?.role));
  const rest = arr.filter((m) => !isSystem((m as { role?: unknown })?.role));
  if (rest.length === 0) return body;

  const isAssistant = (r: unknown) => r === "assistant" || r === "model";
  let i = rest.length - 1;
  while (i >= 0 && !isAssistant((rest[i] as { role?: unknown })?.role)) i--;
  const tail = rest.slice(i + 1);
  const older = rest.slice(0, i + 1);
  if (older.length === 0) return body;

  const contentOf = (m: unknown) => {
    const rec = m as { content?: unknown; parts?: unknown };
    return rec.content ?? rec.parts;
  };
  const budgetChars = (contextWindow || 200000) * 0.8 * CHARS_PER_TOKEN;

  const headKept = older.slice(0, HEAD_KEEP);
  let total = 0;
  for (const m of systemMsgs.concat(headKept, tail)) total += blockLength(contentOf(m));

  let head = headKept;
  while (total > budgetChars && head.length > 0) {
    const dropped = head.pop();
    total -= blockLength(contentOf(dropped));
  }

  if (head.length === older.length) return body;
  return { ...body, [key]: [...systemMsgs, ...head, ...tail] };
}

export function withCapacityAdapterStripping(
  handleSingleModel: (body: JsonRecord, modelStr: string, isPanel?: boolean) => Promise<Response>,
  adapterModels: string[],
): (body: JsonRecord, modelStr: string, isPanel?: boolean) => Promise<Response> {
  const adapterSet = new Set(adapterModels);
  if (adapterSet.size === 0) return handleSingleModel;
  return (body, modelStr, isPanel) => {
    if (adapterSet.has(modelStr)) {
      const slash = modelStr.indexOf("/");
      const provider = slash > 0 ? modelStr.slice(0, slash) : "";
      const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
      const { contextWindow } = getCapabilitiesForModel(provider, model);
      body = stripHistoryForContext(body, contextWindow);
    }
    return handleSingleModel(body, modelStr, isPanel);
  };
}
