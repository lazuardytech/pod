import { initTranslators } from "open-sse/translator/index.js";
import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { sanitizeError } from "@/lib/sanitizeError";
import { handleChat } from "@/sse/handlers/chat";
import { anthropicErrorResponse } from "@/lib/anthropicError";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request: any) {
  try {
    const result = await withApiKeyRateLimit(request, async () => {
      await ensureInitialized();
      return await handleChat(request);
    });
    return result;
  } catch (error) {
    return anthropicErrorResponse(500, sanitizeError(error));
  }
}
