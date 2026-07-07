const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const ERROR_MAP: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  402: "billing_error",
  403: "permission_error",
  404: "not_found_error",
  429: "rate_limit_error",
  500: "api_error",
  502: "api_error",
  503: "overloaded_error",
  504: "timeout_error",
};

export function anthropicErrorResponse(status: number, message: string) {
  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: ERROR_MAP[status] ?? "api_error",
        message,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        ...CORS_HEADERS,
      },
    },
  );
}
