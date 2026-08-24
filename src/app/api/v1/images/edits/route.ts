import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { getSettings } from "@/lib/localDb";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

async function rejectIfApiKeyRequired(request: Request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return Response.json(
      { error: { message: "Missing API key", type: "authentication_error", param: null } },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  if (!(await isValidApiKey(apiKey))) {
    return Response.json(
      { error: { message: "Invalid API key", type: "authentication_error", param: null } },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  return null;
}

/**
 * POST /v1/images/edits - Edit an image
 * ponytail: returns 501 until image editing implementation is needed
 */
export async function POST(request: Request) {
  return await withApiKeyRateLimit(request, async () => {
    const denied = await rejectIfApiKeyRequired(request);
    if (denied) return denied;
    return Response.json(
      {
        error: {
          message: "Image edits are not yet supported",
          type: "invalid_request_error",
          param: null,
          code: "not_implemented",
        },
      },
      { status: 501, headers: CORS_HEADERS },
    );
  });
}
