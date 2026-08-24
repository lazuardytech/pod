import { initTranslators } from "open-sse/translator/index.ts";
import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { sanitizeError } from "@/lib/sanitizeError";
import { handleChat } from "@/sse/handlers/chat";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === "AbortError") return true;
  if (typeof e.message === "string" && e.message.toLowerCase().includes("aborted")) return true;
  return false;
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request: Request) {
  try {
    return await withApiKeyRateLimit(request, async () => {
      await ensureInitialized();
      try {
        return await handleChat(request);
      } catch (err) {
        if (isAbortError(err)) {
          // Client disconnected — no body to return, no error to log
          return new Response(null, { status: 499 });
        }
        throw err;
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: {
          message: sanitizeError(error),
          type: "server_error",
          param: null,
          code: "internal_server_error",
        },
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}
