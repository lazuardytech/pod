import { checkRateLimitByKey } from "@/lib/rateLimit";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { extractApiKey } from "@/sse/services/auth.js";

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
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return Response.json(
        { error: { message: "Missing API key", code: 401 } },
        { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }
    const valid = await validateApiKey(apiKey);
    if (!valid) {
      return Response.json(
        { error: { message: "Invalid API key", code: 401 } },
        { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    // Rate limit check
    const rateCheck = await checkRateLimitByKey(apiKey);
    if (!rateCheck.ok) {
      return rateCheck.response;
    }
  }

  try {
    // Collect all models from all providers
    const models = [];

    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    return Response.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json({ error: { message: error.message } }, { status: 500 });
  }
}
