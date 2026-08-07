// Import directly from file to avoid pulling in server-side dependencies via index.js
export {
  findModelName,
  getDefaultModel,
  getModelQuotaFamily,
  getModelStrip,
  getModelsByProviderId,
  getModelTargetFormat,
  getModelUpstreamId,
  getProviderModels,
  isValidModel as isValidModelCore,
  PROVIDER_ID_TO_ALIAS,
  PROVIDER_MODELS,
} from "open-sse/config/providerModels.js";

import { PROVIDER_MODELS as MODELS, type ProviderModel } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, isOpenAICompatibleProvider, type ProviderDefinition } from "./providers";

// Providers that accept any model (passthrough)
const PASSTHROUGH_PROVIDERS = new Set<string>(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]: [string, ProviderDefinition]) => p.passthroughModels)
    .map(([key]: [string, ProviderDefinition]) => key),
);

// Wrap isValidModel with passthrough providers
export function isValidModel(aliasOrId: string, modelId: string): boolean {
  if (isOpenAICompatibleProvider(aliasOrId)) return true;
  if (PASSTHROUGH_PROVIDERS.has(aliasOrId)) return true;
  const models = (MODELS as Record<string, ProviderModel[]>)[aliasOrId];
  if (!models) return false;
  return models.some((m) => m.id === modelId);
}

export type LegacyAIModel = { provider: string; model: string; name: string };

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS: LegacyAIModel[] = Object.entries(MODELS).flatMap(
  ([alias, models]: [string, ProviderModel[]]) =>
    models.map((m) => ({ provider: alias, model: m.id, name: m.name })),
);
