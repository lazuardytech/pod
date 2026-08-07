import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { handleStt } from "@/sse/handlers/stt";

// Allow large audio uploads — 5min for processing large files
export const maxDuration = 300;

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
 * POST /v1/audio/translations - OpenAI Whisper compatible audio translation
 * Translates audio into English text. Shares the same STT pipeline as transcriptions.
 */
export async function POST(request: Request) {
  return await withApiKeyRateLimit(request, () => handleStt(request, { translate: true }));
}
