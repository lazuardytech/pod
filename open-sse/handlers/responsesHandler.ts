/**
 * Responses API Handler for Workers
 * Converts Chat Completions to Codex Responses API format
 */

import { createResponsesApiTransformStream } from "../transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../transformer/streamToJsonConverter.js";
import { convertResponsesApiFormat } from "../translator/helpers/responsesApiHelper.js";
import { handleChatCore } from "./chatCore.js";

type JsonRecord = Record<string, unknown>;

type ChatLogger = {
  debug?: (scope: string, message: string) => void;
  error?: (scope: string, message: string) => void;
  info?: (scope: string, message: string) => void;
  warn?: (scope: string, message: string) => void;
};

export type ResponsesCoreParams = {
  body: JsonRecord;
  modelInfo: { provider: string; model: string };
  credentials: JsonRecord | null;
  log?: ChatLogger | null;
  onCredentialsRefreshed?: (newCreds: JsonRecord) => Promise<void> | void;
  onRequestSuccess?: () => Promise<void> | void;
  onDisconnect?: (reason?: unknown) => Promise<void> | void;
  connectionId: string;
};

type ResponsesCoreResult =
  | { success: true; response: Response }
  | { success: false; status?: number; error?: string; response?: Response };

/**
 * Handle /v1/responses request
 */
export async function handleResponsesCore({
  body,
  modelInfo,
  credentials,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
  onDisconnect,
  connectionId,
}: ResponsesCoreParams): Promise<ResponsesCoreResult> {
  // Convert Responses API format to Chat Completions format
  const convertedBody = convertResponsesApiFormat(body) as JsonRecord & { stream?: boolean };

  // Preserve client's stream preference (matches OpenClaw behavior)
  // Default to false if omitted: Boolean(undefined) = false
  const clientRequestedStreaming = convertedBody.stream === true;
  if (convertedBody.stream === undefined) {
    convertedBody.stream = false;
  }

  // Call chat core handler — force sourceFormat so streaming path knows this is a Responses API client
  const result = await handleChatCore({
    body: convertedBody,
    modelInfo,
    credentials,
    log: log ?? null,
    onCredentialsRefreshed,
    onRequestSuccess,
    onDisconnect,
    connectionId,
    sourceFormatOverride: "openai-responses",
  });

  if (!result.success || !result.response) {
    return result;
  }

  const response = result.response;
  const contentType = response.headers.get("Content-Type") || "";

  // Case 1: Client wants non-streaming, but got SSE (provider forced it, e.g., Codex)
  if (!clientRequestedStreaming && contentType.includes("text/event-stream")) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(response.body);

      return {
        success: true,
        response: new Response(JSON.stringify(jsonResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
          },
        }),
      };
    } catch (error: unknown) {
      console.error("[Responses API] Stream-to-JSON conversion failed:", error);
      return {
        success: false,
        status: 500,
        error: "Failed to convert streaming response to JSON",
      };
    }
  }

  // Case 2: Client wants streaming, got SSE - transform it
  if (clientRequestedStreaming && contentType.includes("text/event-stream")) {
    const transformStream = createResponsesApiTransformStream(null);
    const streamBody = response.body;
    if (!streamBody) {
      return result;
    }
    const transformedBody = streamBody.pipeThrough(transformStream);

    return {
      success: true,
      response: new Response(transformedBody, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  // Case 3: Non-SSE response (error or non-streaming from provider) - return as-is
  return result;
}
