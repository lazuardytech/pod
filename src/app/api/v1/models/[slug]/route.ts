import { getCombos, getSettings, validateApiKey } from "@/lib/localDb";
import { checkRateLimitByKey } from "@/lib/rateLimit";
import { sanitizeError } from "@/lib/sanitizeError";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { extractApiKey } from "@/sse/services/auth";
import { buildModelsList } from "../route";

// URL slug -> service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP: Record<string, string[]> = {
  image: ["image"],
  tts: ["tts"],
  stt: ["stt"],
  embedding: ["embedding"],
  "image-to-text": ["imageToText"],
  web: ["webSearch", "webFetch"],
};

const CORS = { "Access-Control-Allow-Origin": "*" };

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
 * GET /v1/models/{slug} — handles BOTH kind-filtered model list AND single model lookup.
 * If slug matches a known kind (image, tts, etc.) → return kind-filtered list.
 * Otherwise → treat as model ID lookup.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const settings = await getSettings();
    if (settings.requireApiKey) {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return Response.json(
          { error: { message: "Missing API key", type: "authentication_error", param: null } },
          { status: 401, headers: CORS },
        );
      }
      const valid = await validateApiKey(apiKey);
      if (!valid) {
        return Response.json(
          { error: { message: "Invalid API key", type: "authentication_error", param: null } },
          { status: 401, headers: CORS },
        );
      }
      const rateCheck = await checkRateLimitByKey(apiKey);
      if (!rateCheck.ok) return rateCheck.response;
    }

    const { slug } = await params;

    // If known kind → return kind-filtered model list
    const kindFilter = KIND_SLUG_MAP[slug as keyof typeof KIND_SLUG_MAP];
    if (kindFilter) {
      const data = await buildModelsList(kindFilter);
      return Response.json({ object: "list", data }, { headers: CORS });
    }

    // Otherwise → single model lookup
    const modelId = slug;
    const timestamp = Math.floor(Date.now() / 1000);

    // Check combos
    const combos = await getCombos().catch(() => []);
    for (const combo of combos) {
      if ((combo as Record<string, unknown>).name === modelId) {
        return Response.json(
          { id: modelId, object: "model", created: timestamp, owned_by: "combo" },
          { headers: CORS },
        );
      }
    }

    // Check PROVIDER_MODELS
    for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
      const prefix = `${alias}/`;
      if (modelId.startsWith(prefix)) {
        const bareId = modelId.slice(prefix.length);
        for (const model of providerModels) {
          if ((model as Record<string, unknown>).id === bareId) {
            return Response.json(
              { id: modelId, object: "model", created: timestamp, owned_by: alias },
              { headers: CORS },
            );
          }
        }
      }
    }

    // Check AI_PROVIDERS sub-config models (TTS, embedding, search, fetch)
    for (const [providerId, providerInfo] of Object.entries(AI_PROVIDERS)) {
      const alias = getProviderAlias(providerId) || PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const prefix = `${alias}/`;
      if (!modelId.startsWith(prefix)) continue;
      const bareId = modelId.slice(prefix.length);

      const subConfigModels: string[] = [];
      const ttsConfig = (providerInfo as Record<string, unknown>).ttsConfig as
        | { models?: Array<{ id?: string }> }
        | undefined;
      if (Array.isArray(ttsConfig?.models)) {
        for (const m of ttsConfig.models) {
          if (m?.id) subConfigModels.push(m.id);
        }
      }
      const embeddingConfig = (providerInfo as Record<string, unknown>).embeddingConfig as
        | { models?: Array<{ id?: string }> }
        | undefined;
      if (Array.isArray(embeddingConfig?.models)) {
        for (const m of embeddingConfig.models) {
          if (m?.id) subConfigModels.push(m.id);
        }
      }
      if (subConfigModels.includes(bareId)) {
        return Response.json(
          { id: modelId, object: "model", created: timestamp, owned_by: alias },
          { headers: CORS },
        );
      }

      if (bareId === "search" && (providerInfo as Record<string, unknown>).searchConfig) {
        return Response.json(
          { id: modelId, object: "model", created: timestamp, owned_by: alias, kind: "webSearch" },
          { headers: CORS },
        );
      }
      if (bareId === "fetch" && (providerInfo as Record<string, unknown>).fetchConfig) {
        return Response.json(
          { id: modelId, object: "model", created: timestamp, owned_by: alias, kind: "webFetch" },
          { headers: CORS },
        );
      }
    }

    // Not found
    return Response.json(
      {
        error: {
          message: `Model '${modelId}' not found`,
          type: "invalid_request_error",
          param: null,
          code: "model_not_found",
        },
      },
      { status: 404, headers: CORS },
    );
  } catch (error) {
    return Response.json(
      { error: { message: sanitizeError(error), type: "server_error", param: null } },
      { status: 500, headers: CORS },
    );
  }
}
