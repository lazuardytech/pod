const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /v1/images/variations - Create an image variation
 * ponytail: returns 501 until image variation implementation is needed
 */
export async function POST() {
  return Response.json(
    {
      error: {
        message: "Image variations are not yet supported",
        type: "invalid_request_error",
        param: null,
        code: "not_implemented",
      },
    },
    { status: 501, headers: CORS_HEADERS },
  );
}
