import { asApiRecord } from "@/app/api/_types";
import {
  getCombos,
  getCustomModels,
  getModelAliases,
  getProviderConnections,
  getSettings,
  validateApiKey,
  type Combo,
  type CustomModel,
  type ProviderConnection,
} from "@/lib/localDb";
import { checkRateLimitByKey } from "@/lib/rateLimit";
import { sanitizeError } from "@/lib/sanitizeError";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { extractApiKey } from "@/sse/services/auth";
import type { ProviderModel } from "open-sse/config/providerModels.js";

type ConnectionCreds = ProviderConnection & {
  apiKey?: string;
  accessToken?: string;
  providerSpecificData?: {
    baseUrl?: string;
    prefix?: string;
    enabledModels?: unknown;
    [key: string]: unknown;
  };
};

type OpenAIStyleModel = {
  id?: unknown;
  name?: unknown;
  model?: unknown;
  [key: string]: unknown;
};

const parseOpenAIStyleModels = (data: unknown): OpenAIStyleModel[] => {
  if (Array.isArray(data)) return data as OpenAIStyleModel[];
  const rec = asApiRecord(data);
  const list = rec.data ?? rec.models ?? rec.results;
  return Array.isArray(list) ? (list as OpenAIStyleModel[]) : [];
};

// Matches provider IDs that are upstream/cross-instance connections (contain a UUID suffix)
const UPSTREAM_CONNECTION_RE = /[-_][0-9a-f]{8,}$/i;

// LLM kind sentinel — combos/models with no explicit kind default to LLM
const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
};

function modelKind(model: ProviderModel | { type?: string } | null | undefined) {
  if (!model?.type) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[model.type as keyof typeof MODEL_TYPE_TO_KIND] || LLM_KIND;
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
function inferKindFromUnknownModelId(modelId: unknown) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

async function fetchCompatibleModelIds(connection: ConnectionCreds) {
  if (!connection?.apiKey) return [];

  const baseUrl =
    typeof connection?.providerSpecificData?.baseUrl === "string"
      ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
      : "";

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter(
            (modelId): modelId is string => typeof modelId === "string" && modelId.trim() !== "",
          ),
      ),
    );
  } catch {
    return [];
  }
}

// Provider matches kindFilter when its serviceKinds intersect the requested kinds.
// LLM is the default kind for providers missing serviceKinds.
function providerMatchesKinds(providerId: string, kindFilter: string[]) {
  const provider = AI_PROVIDERS[providerId];
  const kinds =
    Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
      ? provider.serviceKinds
      : [LLM_KIND];
  return kindFilter.some((k) => (kinds as string[]).includes(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo: Combo & { kind?: string }, kindFilter: string[]) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.includes(kind);
}

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 */
export async function buildModelsList(kindFilter: string[]) {
  let connections: ConnectionCreds[] = [];
  try {
    connections = (await getProviderConnections()) as ConnectionCreds[];
    connections = connections.filter((c) => c.isActive !== false);
  } catch (_e) {
    console.log("Could not fetch providers, returning all models");
  }

  let combos: Array<Combo & { kind?: string; name?: string }> = [];
  try {
    combos = await getCombos();
  } catch (_e) {
    console.log("Could not fetch combos");
  }

  let customModels: CustomModel[] = [];
  try {
    customModels = await getCustomModels();
  } catch (_e) {
    console.log("Could not fetch custom models");
  }

  let modelAliases: Record<string, unknown> = {};
  try {
    modelAliases = await getModelAliases();
  } catch (_e) {
    console.log("Could not fetch model aliases");
  }

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models: Record<string, unknown>[] = [];
  const timestamp = Math.floor(Date.now() / 1000);
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry: Record<string, unknown> = {
      id: (combo as Record<string, unknown>).name,
      object: "model",
      created: timestamp,
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    }
    models.push(entry);
  }

  if (connections.length === 0) {
    // DB unavailable -> return static models, filtered by per-model kind
    const aliasToProviderId = Object.fromEntries(
      Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id]),
    );
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const providerId = aliasToProviderId[alias] || alias;
      if (!providerMatchesKinds(providerId, kindFilter)) continue;
      for (const model of providerModels) {
        if (!kindFilter.includes(modelKind(model))) continue;
        models.push({
          id: `${alias}/${model.id}`,
          object: "model",
          created: timestamp,
          owned_by: alias,
        });
      }
    }

    for (const customModel of customModels) {
      if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
      // Custom models without active connection are LLM-only by current schema
      if (!kindFilter.includes(LLM_KIND)) continue;
      const providerAlias = customModel.providerAlias;
      if (!providerAlias) continue;

      const modelId = String(customModel.id).trim();
      if (!modelId) continue;

      models.push({
        id: `${providerAlias}/${modelId}`,
        object: "model",
        created: timestamp,
        owned_by: providerAlias,
      });
    }
  } else {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      if (!providerMatchesKinds(providerId, kindFilter)) continue;

      const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const outputAlias = (
        conn?.providerSpecificData?.prefix ||
        getProviderAlias(providerId) ||
        staticAlias
      ).trim();
      const providerModels = PROVIDER_MODELS[staticAlias as keyof typeof PROVIDER_MODELS] || [];
      const enabledModels = conn?.providerSpecificData?.enabledModels;
      const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
      const isCompatibleProvider =
        isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      // Build kind lookup for static models so we can filter even when only IDs are exposed
      const staticModelKindById = new Map(providerModels.map((m) => [m.id, modelKind(m)]));

      let rawModelIds = hasExplicitEnabledModels
        ? Array.from(
            new Set(
              (enabledModels as unknown[]).filter(
                (modelId): modelId is string =>
                  typeof modelId === "string" && modelId.trim() !== "",
              ),
            ),
          )
        : providerModels.map((model) => model.id);

      if (
        isCompatibleProvider &&
        rawModelIds.length === 0 &&
        !UPSTREAM_CONNECTION_RE.test(providerId)
      ) {
        rawModelIds = await fetchCompatibleModelIds(conn);
      }

      const modelIds = rawModelIds
        .map((modelId: string) => {
          if (modelId.startsWith(`${outputAlias}/`)) {
            return modelId.slice(outputAlias.length + 1);
          }
          if (modelId.startsWith(`${staticAlias}/`)) {
            return modelId.slice(staticAlias.length + 1);
          }
          if (modelId.startsWith(`${providerId}/`)) {
            return modelId.slice(providerId.length + 1);
          }
          return modelId;
        })
        .filter(
          (modelId): modelId is string => typeof modelId === "string" && modelId.trim() !== "",
        );

      const customModelIds = customModels
        .filter((m) => {
          if (!m?.id || (m.type && m.type !== "llm")) return false;
          const alias = m.providerAlias;
          return alias === staticAlias || alias === outputAlias || alias === providerId;
        })
        .map((m) => String(m.id).trim())
        .filter((modelId) => modelId !== "");

      const aliasModelIds = Object.values(modelAliases || {})
        .filter((fullModel): fullModel is string => {
          if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
          return (
            fullModel.startsWith(`${outputAlias}/`) ||
            fullModel.startsWith(`${staticAlias}/`) ||
            fullModel.startsWith(`${providerId}/`)
          );
        })
        .map((fullModel) => {
          const model = fullModel;
          if (model.startsWith(`${outputAlias}/`)) {
            return model.slice(outputAlias.length + 1);
          }
          if (model.startsWith(`${staticAlias}/`)) {
            return model.slice(staticAlias.length + 1);
          }
          if (model.startsWith(`${providerId}/`)) {
            return model.slice(providerId.length + 1);
          }
          return model;
        })
        .filter(
          (modelId): modelId is string => typeof modelId === "string" && modelId.trim() !== "",
        );

      const mergedModelIds = Array.from(
        new Set([...modelIds, ...customModelIds, ...aliasModelIds]),
      );

      for (const modelId of mergedModelIds) {
        // Resolve kind: prefer static metadata, otherwise infer from ID heuristics
        const kind = staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
        if (!kindFilter.includes(kind)) continue;

        models.push({
          id: `${outputAlias}/${modelId}`,
          object: "model",
          created: timestamp,
          owned_by: outputAlias,
        });
      }

      // Merge sub-config models (TTS / embedding) that live on AI_PROVIDERS, not PROVIDER_MODELS
      const providerInfo = AI_PROVIDERS[providerId];
      const subConfigModels: string[] = [];
      if (kindFilter.includes("tts") && Array.isArray(providerInfo?.ttsConfig?.models)) {
        for (const m of providerInfo.ttsConfig.models) {
          if (m?.id) subConfigModels.push(m.id);
        }
      }
      if (
        kindFilter.includes("embedding") &&
        Array.isArray(providerInfo?.embeddingConfig?.models)
      ) {
        for (const m of providerInfo.embeddingConfig.models) {
          if (m?.id) subConfigModels.push(m.id);
        }
      }
      for (const subId of subConfigModels) {
        models.push({
          id: `${outputAlias}/${subId}`,
          object: "model",
          created: timestamp,
          owned_by: outputAlias,
        });
      }

      // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
      if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
        models.push({
          id: `${outputAlias}/search`,
          object: "model",
          kind: "webSearch",
          created: timestamp,
          owned_by: outputAlias,
        });
      }
      if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
        models.push({
          id: `${outputAlias}/fetch`,
          object: "model",
          kind: "webFetch",
          created: timestamp,
          owned_by: outputAlias,
        });
      }
    }
  }

  const dedupedModels: Record<string, unknown>[] = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    dedupedModels.push(model);
  }

  return dedupedModels;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request: Request) {
  try {
    const settings = await getSettings();
    if ((settings as Record<string, unknown>).requireApiKey) {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return Response.json(
          {
            error: {
              message: "Missing API key",
              type: "authentication_error",
              param: null,
              code: "invalid_api_key",
            },
          },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
        );
      }
      const valid = await validateApiKey(apiKey);
      if (!valid) {
        return Response.json(
          {
            error: {
              message: "Invalid API key",
              type: "authentication_error",
              param: null,
              code: "invalid_api_key",
            },
          },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
        );
      }

      // Rate limit check
      const rateCheck = await checkRateLimitByKey(apiKey);
      if (!rateCheck.ok) {
        return rateCheck.response;
      }
    }

    const data = await buildModelsList([LLM_KIND]);
    return Response.json(
      { object: "list", data },
      {
        headers: { "Access-Control-Allow-Origin": "*" },
      },
    );
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      {
        error: {
          message: sanitizeError(error),
          type: "server_error",
          param: null,
          code: "internal_server_error",
        },
      },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
