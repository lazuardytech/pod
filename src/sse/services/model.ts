import { getModelInfoCore, parseModel, resolveModelAliasFromMap } from "open-sse/services/model.js";
import { getComboByName, getModelAliases, getProviderNodes } from "@/lib/localDb";

export { parseModel };
export type ModelInfo = { provider: string | null; model: string };
export type ComboInfo = {
  models: string[];
  systemPrompt: string | null;
  modelId: string | null;
  contentFilterMessage: string | null;
} | null;
export async function resolveModelAlias(
  alias: string,
): Promise<{ provider: string; model: string } | null> {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}
export async function getModelInfo(modelStr: string): Promise<ModelInfo> {
  const parsed = parseModel(modelStr);
  if (!parsed.isAlias) {
    const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
    const m1 = openaiNodes.find((n) => n.prefix === parsed.providerAlias);
    if (m1) return { provider: m1.id, model: parsed.model };
    const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
    const m2 = anthropicNodes.find((n) => n.prefix === parsed.providerAlias);
    if (m2) return { provider: m2.id, model: parsed.model };
    const embNodes = await getProviderNodes({ type: "custom-embedding" });
    const m3 = embNodes.find((n) => n.prefix === parsed.providerAlias);
    if (m3) return { provider: m3.id, model: parsed.model };
    return { provider: parsed.provider, model: parsed.model };
  }
  const combo = await getComboByName(parsed.model);
  if (combo) return { provider: null, model: parsed.model };
  return getModelInfoCore(modelStr, getModelAliases);
}
export async function getComboModels(modelStr: string): Promise<string[] | null> {
  if (modelStr.includes("/")) return null;
  const combo = await getComboByName(modelStr);
  const models = combo?.models as string[] | undefined;
  if (combo && models && models.length > 0) return models;
  return null;
}
export async function getComboInfo(modelStr: string): Promise<ComboInfo> {
  if (modelStr.includes("/")) return null;
  const combo = await getComboByName(modelStr);
  const models = combo?.models as string[] | undefined;
  if (combo && models && models.length > 0) {
    return {
      models,
      systemPrompt: (combo.systemPrompt as string) || null,
      modelId: (combo.modelId as string) || null,
      contentFilterMessage: (combo.contentFilterMessage as string) || null,
    };
  }
  return null;
}
