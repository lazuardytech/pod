import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { extractApiKey } from "@/sse/services/auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * GET /v1/files/{file_id} - Retrieve file metadata
 */
export async function GET(request: any, { params }: { params: any }) {
  return await withApiKeyRateLimit(request, async () => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return Response.json(
        { error: { message: "Missing API key", type: "authentication_error", param: null } },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    const { file_id } = await params;
    return Response.json(
      {
        error: {
          message: `File '${file_id}' not found`,
          type: "invalid_request_error",
          param: null,
          code: "file_not_found",
        },
      },
      { status: 404, headers: CORS_HEADERS },
    );
  });
}

/**
 * DELETE /v1/files/{file_id} - Delete a file
 */
export async function DELETE(request: any, { params }: { params: any }) {
  return await withApiKeyRateLimit(request, async () => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return Response.json(
        { error: { message: "Missing API key", type: "authentication_error", param: null } },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    const { file_id } = await params;
    return Response.json(
      {
        error: {
          message: `File '${file_id}' not found`,
          type: "invalid_request_error",
          param: null,
          code: "file_not_found",
        },
      },
      { status: 404, headers: CORS_HEADERS },
    );
  });
}
