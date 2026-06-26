import { checkRateLimitByKey } from "@/lib/rateLimit";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { extractApiKey } from "@/sse/services/auth";
import { buildModelsList } from "../route";

import { sanitizeError } from "@/lib/sanitizeError";
// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  image: ["image"],
  tts: ["tts"],
  stt: ["stt"],
  embedding: ["embedding"],
  "image-to-text": ["imageToText"],
  web: ["webSearch", "webFetch"],
};

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
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * Supported kinds: image, tts, stt, embedding, image-to-text, web.
 */
export async function GET(request, { params }) {
  try {
    const settings = await getSettings();
    if (settings.requireApiKey) {
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        return Response.json(
          { error: { message: "Missing API key", type: "authentication_error" } },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
        );
      }
      const valid = await validateApiKey(apiKey);
      if (!valid) {
        return Response.json(
          { error: { message: "Invalid API key", type: "authentication_error" } },
          { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
        );
      }

      // Rate limit check
      const rateCheck = await checkRateLimitByKey(apiKey);
      if (!rateCheck.ok) {
        return rateCheck.response;
      }
    }

    const { kind } = await params;
    const kindFilter = KIND_SLUG_MAP[kind];

    if (!kindFilter) {
      return Response.json(
        {
          error: {
            message: `Unknown model kind: ${kind}. Supported: ${Object.keys(KIND_SLUG_MAP).join(", ")}`,
            type: "invalid_request_error",
          },
        },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const data = await buildModelsList(kindFilter);
    return Response.json(
      { object: "list", data },
      {
        headers: { "Access-Control-Allow-Origin": "*" },
      },
    );
  } catch (error) {
    console.log("Error fetching models by kind:", error);
    return Response.json({ error: { message: sanitizeError(error), type: "server_error" } }, { status: 500 });
  }
}
