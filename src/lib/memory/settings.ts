const DEFAULT_MEMORY_SETTINGS = {
  enabled: true,
  maxTokens: 2000,
  retentionDays: 30,
  strategy: "hybrid",
} as const;

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizeStrategy(value: unknown): "exact" | "semantic" | "hybrid" | "recent" {
  return value === "recent" || value === "semantic" || value === "hybrid"
    ? value
    : DEFAULT_MEMORY_SETTINGS.strategy;
}

export type MemorySettings = {
  enabled: boolean;
  maxTokens: number;
  retentionDays: number;
  strategy: "exact" | "semantic" | "hybrid" | "recent";
};

export function normalizeMemorySettings(rawSettings: Record<string, unknown> = {}): MemorySettings {
  return {
    enabled: toBoolean(rawSettings.memoryEnabled, DEFAULT_MEMORY_SETTINGS.enabled),
    maxTokens: clampInteger(
      rawSettings.memoryMaxTokens,
      DEFAULT_MEMORY_SETTINGS.maxTokens,
      0,
      16000,
    ),
    retentionDays: clampInteger(
      rawSettings.memoryRetentionDays,
      DEFAULT_MEMORY_SETTINGS.retentionDays,
      1,
      365,
    ),
    strategy: normalizeStrategy(rawSettings.memoryStrategy),
  };
}

export function toMemorySettingsUpdates(
  settings: Partial<MemorySettings> = {},
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (settings.enabled !== undefined) updates.memoryEnabled = settings.enabled;
  if (settings.maxTokens !== undefined) updates.memoryMaxTokens = settings.maxTokens;
  if (settings.retentionDays !== undefined) updates.memoryRetentionDays = settings.retentionDays;
  if (settings.strategy !== undefined) updates.memoryStrategy = settings.strategy;
  return updates;
}

export function toMemoryRetrievalConfig(settings: MemorySettings | null | undefined): {
  enabled: boolean;
  maxTokens: number;
  retrievalStrategy: "exact" | "semantic" | "hybrid";
  retentionDays: number;
  scope: "apiKey";
} {
  const enabled = settings?.enabled === true && Number(settings?.maxTokens || 0) > 0;
  return {
    enabled,
    maxTokens: enabled ? (settings?.maxTokens as number) : 0,
    retrievalStrategy: settings?.strategy === "recent" ? "exact" : settings?.strategy || "hybrid",
    retentionDays: Number.isFinite(settings?.retentionDays)
      ? (settings?.retentionDays as number)
      : 30,
    scope: "apiKey",
  };
}
