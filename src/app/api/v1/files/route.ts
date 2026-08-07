import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { extractApiKey } from "@/sse/services/auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * GET /v1/files - List uploaded files
 * ponytail: returns empty list until file storage is needed
 */
export async function GET(request: Request) {
  return await withApiKeyRateLimit(request, async () => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return Response.json(
        { error: { message: "Missing API key", type: "authentication_error", param: null } },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    return Response.json({ object: "list", data: [] }, { headers: CORS_HEADERS });
  });
}

/**
 * POST /v1/files - Upload a file
 * ponytail: returns 501 until file storage is implemented
 */
export async function POST() {
  return Response.json(
    {
      error: {
        message: "File uploads are not yet supported",
        type: "invalid_request_error",
        param: null,
        code: "not_implemented",
      },
    },
    { status: 501, headers: CORS_HEADERS },
  );
}
