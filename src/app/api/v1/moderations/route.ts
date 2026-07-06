import { sanitizeError } from "@/lib/sanitizeError";
import { withApiKeyRateLimit } from "@/lib/rateLimit";

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
 * POST /v1/moderations - OpenAI-compatible moderations endpoint
 * Returns a mock moderation result. Real moderation requires upstream provider support.
 * Returns a pass/not-flagged result by default so clients don't break.
 */
export async function POST(request: any) {
  return await withApiKeyRateLimit(request, async () => {
    try {
      const id = `modr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      return Response.json(
        {
          id,
          model: "text-moderation-latest",
          results: [
            {
              flagged: false,
              categories: {
                hate: false,
                "hate/threatening": false,
                "self-harm": false,
                sexual: false,
                "sexual/minors": false,
                violence: false,
                "violence/graphic": false,
              },
              category_scores: {
                hate: 0.01,
                "hate/threatening": 0.01,
                "self-harm": 0.01,
                sexual: 0.01,
                "sexual/minors": 0.01,
                violence: 0.01,
                "violence/graphic": 0.01,
              },
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    } catch (error) {
      return Response.json(
        { error: { message: sanitizeError(error), type: "server_error", param: null } },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }
  });
}
