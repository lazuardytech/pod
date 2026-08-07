import { generateDetailId, saveRequestDetail } from "@/lib/usageDb";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { FORMATS } from "../../translator/formats.js";
import { createErrorResult } from "../../utils/error.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";

type ForcedSSEToJsonResult =
  | { success: true; response: Response }
  | ReturnType<typeof createErrorResult>;

type UsageInfo = Record<string, unknown> & {
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
};

type ResponsesContentItem = { text?: string; type?: string };

type ResponsesOutputItem = {
  arguments?: unknown;
  call_id?: string;
  content?: ResponsesContentItem[];
  name?: string;
  type?: string;
};

type ResponsesJson = {
  created_at?: number;
  id?: string;
  model?: string;
  output?: ResponsesOutputItem[];
  status?: string;
  usage?: UsageInfo;
};

type ChatToolCall = {
  function: { arguments: string; name: string };
  id: string;
  type: "function";
};

type ChatDeltaToolCall = {
  function?: { arguments?: string; name?: string };
  id?: string;
  index?: number;
};

type ChatStreamChunk = {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: ChatDeltaToolCall[];
    };
    finish_reason?: string;
  }[];
  created?: number;
  id?: string;
  model?: string;
  usage?: UsageInfo;
};

type ChatCompletionResponse = {
  choices: {
    finish_reason: string;
    index: number;
    message: {
      content: string | null;
      reasoning_content?: string;
      role: "assistant";
      tool_calls?: ChatToolCall[];
    };
  }[];
  created: number;
  id: string;
  model: string;
  object: "chat.completion";
  usage?: UsageInfo;
};

type ForcedSSEToJsonParams = {
  apiKey?: string;
  appendLog: (entry: { detailsId: string; status: string; tokens: UsageInfo }) => void;
  body: Record<string, unknown>;
  clientRawRequest?: { endpoint?: string };
  connectionId?: string;
  finalBody?: unknown;
  model: string;
  onFinalJsonResponse?: (response: unknown, usage: unknown) => void;
  onRequestSuccess?: () => Promise<void> | void;
  provider: string;
  providerResponse: Response;
  requestStartTime: number;
  sourceFormat: string;
  stream: boolean;
  trackDone: () => void;
  translatedBody?: unknown;
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function textFromResponsesMessageItem(item: ResponsesOutputItem) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const textItem = item.content.find((c) => typeof c.text === "string");
  if (typeof textItem?.text === "string") return textItem.text;
  return "";
}

/**
 * Codex / Responses API may emit many alternating reasoning + message items.
 * Early message blocks often have empty output_text; the user-visible answer is usually in the last non-empty message.
 */
function pickAssistantMessageForChatCompletion(output: unknown) {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null };
  const messages = (output as ResponsesOutputItem[]).filter((item) => item?.type === "message");
  if (messages.length === 0) return { msgItem: null, textContent: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    const text = textFromResponsesMessageItem(message);
    if (text.length > 0) return { msgItem: message, textContent: text };
  }
  const last = messages[messages.length - 1];
  if (!last) return { msgItem: null, textContent: null };
  return { msgItem: last, textContent: textFromResponsesMessageItem(last) };
}

/**
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 * Used when provider forces streaming but client wants non-streaming.
 */
export function parseSSEToOpenAIResponse(rawSSE: unknown, fallbackModel: string) {
  const chunks: ChatStreamChunk[] = [];

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(payload) as ChatStreamChunk);
    } catch {
      /* ignore malformed lines */
    }
  }

  if (chunks.length === 0) return null;

  const first = chunks[0]!;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCallMap = new Map<number, ChatToolCall>(); // index -> { id, type, function: { name, arguments } }
  let finishReason = "stop";
  let usage: UsageInfo | null = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0)
      contentParts.push(delta.content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0)
      reasoningParts.push(delta.reasoning_content);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    // Accumulate tool_calls from streaming deltas
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, {
            id: tc.id || "",
            type: "function",
            function: { name: "", arguments: "" },
          });
        }
        const existing = toolCallMap.get(idx);
        if (!existing) continue;
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const message: ChatCompletionResponse["choices"][number]["message"] = {
    role: "assistant",
    content: contentParts.join("") || (toolCallMap.size > 0 ? null : ""),
  };
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result: ChatCompletionResponse = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }],
  };
  if (usage) result.usage = usage;
  return result;
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 * Supports both Codex/Responses API SSE and standard Chat Completions SSE.
 *
 * No decloak step here on purpose: this path is gated by
 * providerRequiresStreaming === ("openai" | "codex") in chatCore, while
 * cloakClaudeTools() only fires for provider === "claude". So toolNameMap is
 * always null when we get here, and there are no cloaked names in the bytes
 * to undo. If a future change adds Claude to providerRequiresStreaming, this
 * function MUST plumb toolNameMap through and decloak.
 */
export async function handleForcedSSEToJson({
  providerResponse,
  sourceFormat,
  provider,
  model,
  body,
  stream,
  translatedBody,
  finalBody,
  requestStartTime,
  connectionId,
  apiKey,
  clientRawRequest,
  onRequestSuccess,
  trackDone,
  appendLog,
  onFinalJsonResponse,
}: ForcedSSEToJsonParams): Promise<ForcedSSEToJsonResult | null> {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE =
    contentType.includes("text/event-stream") || (contentType === "" && provider === "codex");
  if (!isSSE) return null; // not handled here

  trackDone();

  const ctx = {
    provider,
    model,
    connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
  };

  // Codex/Responses API SSE path
  const isCodexResponsesApi = provider === "codex" || sourceFormat === FORMATS.OPENAI_RESPONSES;
  if (isCodexResponsesApi) {
    try {
      const jsonResponse = (await convertResponsesStreamToJson(
        providerResponse.body,
      )) as ResponsesJson;
      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      const detailsId1 = generateDetailId(model);
      appendLog({ tokens: usage, status: "SUCCESS", detailsId: detailsId1 });
      saveUsageStats({
        provider,
        model,
        tokens: usage,
        connectionId,
        apiKey,
        endpoint: clientRawRequest?.endpoint,
      });

      const { textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(
        buildRequestDetail(
          {
            id: detailsId1,
            ...ctx,
            latency: { ttft: totalLatency, total: totalLatency },
            tokens: {
              prompt_tokens: usage.input_tokens || 0,
              completion_tokens: usage.output_tokens || 0,
            },
            response: {
              content: textContent,
              thinking: null,
              finish_reason: jsonResponse.status || "unknown",
            },
            status: "success",
          },
          { endpoint: clientRawRequest?.endpoint || null },
        ),
      ).catch(() => {
        // Best-effort request detail; response conversion should not fail on logging.
      });

      // Client is Responses API → return as-is
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        try {
          onFinalJsonResponse?.(jsonResponse, usage || null);
        } catch {
          // best effort
        }
        return {
          success: true,
          response: new Response(JSON.stringify(jsonResponse), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          }),
        };
      }

      // Build client-format response
      const inTokens = usage.input_tokens || 0;
      const outTokens = usage.output_tokens || 0;
      let finalResp: unknown;

      // Extract tool calls from Responses API output (function_call items)
      const funcCallItems = (jsonResponse.output || []).filter(
        (item) => item.type === "function_call",
      );
      const toolCalls: ChatToolCall[] = funcCallItems.map((item, idx) => ({
        id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name as string,
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments || {}),
        },
      }));
      const hasToolCalls = toolCalls.length > 0;

      if (
        sourceFormat === FORMATS.ANTIGRAVITY ||
        sourceFormat === FORMATS.GEMINI ||
        sourceFormat === FORMATS.GEMINI_CLI
      ) {
        finalResp = {
          response: {
            candidates: [
              {
                content: { role: "model", parts: [{ text: textContent || "" }] },
                finishReason: "STOP",
                index: 0,
              },
            ],
            usageMetadata: {
              promptTokenCount: inTokens,
              candidatesTokenCount: outTokens,
              totalTokenCount: inTokens + outTokens,
            },
            modelVersion: model,
            responseId: jsonResponse.id || `resp_${Date.now()}`,
          },
        };
      } else {
        const message: ChatCompletionResponse["choices"][number]["message"] = {
          role: "assistant",
          content: textContent || (hasToolCalls ? null : ""),
        };
        if (hasToolCalls) message.tool_calls = toolCalls;
        const finishReason = hasToolCalls
          ? "tool_calls"
          : jsonResponse.status === "completed"
            ? "stop"
            : jsonResponse.status || "stop";
        finalResp = {
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: {
            prompt_tokens: inTokens,
            completion_tokens: outTokens,
            total_tokens: inTokens + outTokens,
          },
        };
      }

      try {
        const finalUsage =
          finalResp && typeof finalResp === "object" && "usage" in finalResp
            ? (finalResp as { usage?: unknown }).usage
            : undefined;
        onFinalJsonResponse?.(finalResp, finalUsage || usage || null);
      } catch {
        // best effort
      }

      return {
        success: true,
        response: new Response(JSON.stringify(finalResp), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    } catch (error: unknown) {
      console.error(
        isAbortError(error)
          ? "[ChatCore] Responses API SSE→JSON aborted"
          : "[ChatCore] Responses API SSE→JSON failed",
      );
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        "Failed to convert streaming response to JSON",
        undefined,
      );
    }
  }

  // Standard Chat Completions SSE path
  try {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed)
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        "Invalid SSE response for non-streaming request",
        undefined,
      );

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    const detailsId2 = generateDetailId(model);
    appendLog({ tokens: usage, status: "SUCCESS", detailsId: detailsId2 });
    saveUsageStats({
      provider,
      model,
      tokens: usage,
      connectionId,
      apiKey,
      endpoint: clientRawRequest?.endpoint,
    });

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(
      buildRequestDetail(
        {
          id: detailsId2,
          ...ctx,
          latency: { ttft: totalLatency, total: totalLatency },
          tokens: usage,
          response: {
            content: parsed.choices?.[0]?.message?.content || null,
            thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
            finish_reason: parsed.choices?.[0]?.finish_reason || "unknown",
          },
          status: "success",
        },
        { endpoint: clientRawRequest?.endpoint || null },
      ),
    ).catch(() => {
      // Best-effort request detail; response conversion should not fail on logging.
    });

    // Preserve reasoning_content even when content is non-empty so clients that
    // expose a dedicated thinking panel can always consume it.

    try {
      onFinalJsonResponse?.(parsed, usage || parsed.usage || null);
    } catch {
      // best effort
    }

    return {
      success: true,
      response: new Response(JSON.stringify(parsed), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }),
    };
  } catch (error: unknown) {
    console.error(
      isAbortError(error)
        ? "[ChatCore] Chat Completions SSE→JSON aborted"
        : "[ChatCore] Chat Completions SSE→JSON failed",
    );
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      "Failed to convert streaming response to JSON",
      undefined,
    );
  }
}
