import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { requireValidApiKey } from "@/lib/routeAuth";
import { handleFetch } from "@/sse/handlers/fetch";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * POST /v1/web/fetch - Web URL fetch/extract endpoint
 */
export async function POST(request: any) {
  const { response } = await requireValidApiKey(request);
  if (response) return response;

  return await withApiKeyRateLimit(request, () => handleFetch(request));
}
