/**
 * testClaude handler — removed, kept as stub for backward compatibility.
 * The /testClaude route is no longer needed; use /v1/messages instead.
 */
export async function handleTestClaude(_request: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ error: "This endpoint is deprecated. Use /v1/messages instead." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}
