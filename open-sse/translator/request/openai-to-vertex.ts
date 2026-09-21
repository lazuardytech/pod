import { DEFAULT_THINKING_VERTEX_SIGNATURE } from "../../config/defaultThinkingSignature.ts";
import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";
import { openaiToGeminiRequest } from "./openai-to-gemini.ts";

type VertexFunctionCall = { id?: unknown };
type VertexPart = {
  thoughtSignature?: unknown;
  functionCall?: VertexFunctionCall;
  functionResponse?: VertexFunctionCall;
};
type VertexTurn = { parts?: VertexPart[] };
type VertexGeminiBody = {
  contents?: VertexTurn[];
  stream?: unknown;
};

/**
 * Post-process a Gemini-format body for Vertex AI compatibility:
 *
 * 1. Replace all synthetic thoughtSignatures with Vertex-native signature.
 * 2. Strip `id` from functionCall and functionResponse (Vertex rejects these).
 */
function postProcessForVertex(body: unknown): VertexGeminiBody {
  const geminiBody = body as VertexGeminiBody; // trusted: output of openaiToGeminiRequest
  if (!geminiBody?.contents) return geminiBody;

  for (const turn of geminiBody.contents) {
    if (!Array.isArray(turn.parts)) continue;

    for (const part of turn.parts) {
      // Replace any synthetic signature with Vertex-native one
      if (part.thoughtSignature !== undefined) {
        part.thoughtSignature = DEFAULT_THINKING_VERTEX_SIGNATURE;
      }
      // Strip id from functionCall
      if (part.functionCall && "id" in part.functionCall) {
        delete part.functionCall.id;
      }
      // Strip id from functionResponse
      if (part.functionResponse && "id" in part.functionResponse) {
        delete part.functionResponse.id;
      }
    }
  }

  return geminiBody;
}

export function openaiToVertexRequest(
  model: unknown,
  body: unknown,
  stream: unknown,
  credentials: unknown,
) {
  // todo(ts): request translator registry may pass credentials to JS-era translators.
  const gemini = openaiToGeminiRequest(model, body, stream, credentials);
  const processed = postProcessForVertex(gemini);
  // Vertex AI does not accept `stream` in the request body — streaming is
  // controlled via the action suffix (:streamGenerateContent) and ?alt=sse.
  delete processed.stream;
  return processed;
}

register(FORMATS.OPENAI, FORMATS.VERTEX, openaiToVertexRequest, null);
