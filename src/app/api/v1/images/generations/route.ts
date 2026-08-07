import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/images/generations - OpenAI-compatible image generation endpoint */
export async function POST(request: Request) {
  return await withApiKeyRateLimit(request, () => handleImageGeneration(request));
}
