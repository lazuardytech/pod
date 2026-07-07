import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { anthropicErrorResponse } from "@/lib/anthropicError";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function POST(request: any) {
  return await withApiKeyRateLimit(request, async () => {
    let body;
    try {
      const [parsed, parseErr] = await parseJsonBody(request);
      if (parseErr) return parseErr;
      body = parsed;
    } catch {
      return anthropicErrorResponse(400, "Invalid JSON body");
    }

    const messages = ((body as Record<string, unknown>).messages as { content?: unknown }[]) || [];
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && part.text) {
            totalChars += part.text.length;
          }
        }
      }
    }

    const inputTokens = Math.ceil(totalChars / 4);

    return new Response(JSON.stringify({ input_tokens: inputTokens }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  });
}
