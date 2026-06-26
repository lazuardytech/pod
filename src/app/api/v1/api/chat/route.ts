import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { handleChat } from "@/sse/handlers/chat";

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
  return await withApiKeyRateLimit(request, async () => {
    await ensureInitialized();

    const clonedReq = request.clone();
    let modelName = "llama3.2";
    try {
      const body = await clonedReq.json();
      modelName = body.model || "llama3.2";
    } catch {}

    const response = await handleChat(request);
    return transformToOllama(response, modelName);
  });
}
