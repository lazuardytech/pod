// Model metadata registry
// Only define models that differ from DEFAULT_MODEL_INFO
// Custom entries are merged over default
const DEFAULT_MODEL_INFO = {
  type: ["chat"],
  contextWindow: 200000,
};

type ModelInfo = {
  type?: string[];
  contextWindow?: number;
  [key: string]: unknown;
};

export const MODEL_INFO: Record<string, ModelInfo> = {};

export function getModelInfo(modelId: string) {
  return { ...DEFAULT_MODEL_INFO, ...MODEL_INFO[modelId] };
}
