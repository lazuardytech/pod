import { initTranslators } from "open-sse/translator/index.ts";
import { withApiKeyRateLimit } from "@/lib/rateLimit";
import { handleChat } from "@/sse/handlers/chat";
import { readBodyTextStream } from "@/lib/parseJsonBody";
import { MAX_CHAT_BODY_BYTES } from "@/shared/constants/config";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

type ChatCompletion = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

/**
 * Map an OpenAI chat.completion object to the Responses API shape.
 * Non-streaming /v1/responses must return object:"response" with output[],
 * not object:"chat.completion" with choices[].
 */
function chatCompletionToResponse(cc: ChatCompletion, fallbackId: string) {
  const baseId = cc.id ?? fallbackId;
  const out: Record<string, unknown> = {
    id: "resp_" + baseId,
    object: "response",
    created_at: cc.created ?? Math.floor(Date.now() / 1000),
    status: "completed",
    model: cc.model,
    output: [
      {
        id: "msg_" + baseId,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: cc.choices?.[0]?.message?.content ?? "",
            annotations: [],
          },
        ],
      },
    ],
  };
  if (cc.usage) {
    out.usage = {
      input_tokens: cc.usage.prompt_tokens,
      output_tokens: cc.usage.completion_tokens,
      total_tokens: cc.usage.total_tokens,
    };
  }
  return out;
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request: Request) {
  return await withApiKeyRateLimit(request, async () => {
    await ensureInitialized();

    // Clone the request so we can inspect the body without consuming the
    // original stream that handleChat reads downstream.
    const probe = request.clone();
    const bodyResult = await readBodyTextStream(probe, { maxBytes: MAX_CHAT_BODY_BYTES });
    if (bodyResult.ok) {
      try {
        const parsed = JSON.parse(bodyResult.text) as Record<string, unknown>;
        const prev = parsed["previous_response_id"];
        if (typeof prev === "string" && prev.length > 0) {
          return new Response(
            JSON.stringify({
              error: {
                message: "previous_response not found",
                type: "invalid_request_error",
                param: "previous_response_id",
                code: "invalid_request_error",
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
          );
        }
      } catch {
        // fall through to handleChat on invalid JSON
      }
    }

    const result = await handleChat(request);
    if (bodyResult.ok) {
      try {
        const parsed = JSON.parse(bodyResult.text) as Record<string, unknown>;
        if (parsed["stream"] !== true) {
          const ct = result.headers.get("Content-Type") ?? "";
          if (ct.includes("application/json")) {
            const cc = (await result.json()) as ChatCompletion;
            const out = chatCompletionToResponse(cc, crypto.randomUUID());
            return new Response(JSON.stringify(out), {
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            });
          }
        }
      } catch {
        // fall through to return original result on parse failure
      }
    }
    return result;
  });
}
