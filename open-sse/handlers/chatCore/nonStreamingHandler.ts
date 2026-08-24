import { generateDetailId, saveRequestDetail } from "@/lib/usageDb";
import { HTTP_STATUS } from "../../config/runtimeConfig.ts";
import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.ts";
import { FORMATS } from "../../translator/formats.ts";
import { needsTranslation } from "../../translator/index.ts";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.ts";
import { decloakToolNames } from "../../utils/claudeCloaking.ts";
import { createErrorResult } from "../../utils/error.ts";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking.ts";
import {
  buildRequestDetail,
  extractRequestConfig,
  extractUsageFromResponse,
  saveUsageStats,
} from "./requestDetail.ts";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.ts";

type JsonRecord = Record<string, unknown>;

type NonStreamingResult =
  | { success: true; response: Response }
  | ReturnType<typeof createErrorResult>;

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAIAssistantMessage = {
  role: "assistant";
  content?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCall[];
};

type OpenAIChatCompletion = JsonRecord & {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIAssistantMessage;
    finish_reason: string;
    logprobs?: unknown;
    content_filter_results?: unknown;
  }>;
  usage?: JsonRecord & {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: { reasoning_tokens: number };
  };
};

type MutableChatCompletion = JsonRecord & {
  object?: string;
  created?: number;
  system_fingerprint?: string;
  prompt_filter_results?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown[];
    };
    finish_reason?: string;
    logprobs?: unknown;
    content_filter_results?: unknown;
  }>;
  usage?: unknown;
  content?: unknown;
  reasoning_content?: unknown;
};

type GeminiPart = {
  thought?: boolean;
  text?: string;
  functionCall?: { name?: string; args?: unknown };
};

type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiUsage = {
  promptTokenCount?: number;
  thoughtsTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsage;
  responseId?: string;
  createTime?: string | number;
  modelVersion?: string;
};

type ClaudeContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type ClaudeResponse = {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  id?: string;
  model?: string;
  usage?: ClaudeUsage;
};

type ResponsesContentItem = { text?: string; type?: string };

type ResponsesOutputItem = {
  type?: string;
  content?: ResponsesContentItem[];
};

type ResponsesJson = {
  created_at?: number;
  id?: string;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

type RequestLoggerLike = {
  logProviderResponse: (
    status?: unknown,
    statusText?: unknown,
    headers?: unknown,
    body?: unknown,
  ) => void;
  logConvertedResponse: (body?: unknown) => void;
};

type NonStreamingParams = {
  providerResponse: Response;
  provider: string;
  model: string;
  sourceFormat: string;
  targetFormat: string;
  body: JsonRecord;
  stream: boolean;
  translatedBody?: unknown;
  finalBody?: unknown;
  requestStartTime: number;
  connectionId?: string;
  apiKey?: string | null;
  clientRawRequest?: { endpoint?: string } | null;
  onRequestSuccess?: () => Promise<void> | void;
  reqLogger: RequestLoggerLike;
  toolNameMap?: unknown;
  trackDone: () => void;
  appendLog: (entry: JsonRecord) => void;
  onFinalJsonResponse?: (response: unknown, usage: unknown) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */
export function translateNonStreamingResponse(
  responseBody: unknown,
  targetFormat: unknown,
  sourceFormat: unknown,
): unknown {
  if (targetFormat === sourceFormat || targetFormat === FORMATS.OPENAI) return responseBody;

  // Gemini / Antigravity
  if (
    targetFormat === FORMATS.GEMINI ||
    targetFormat === FORMATS.ANTIGRAVITY ||
    targetFormat === FORMATS.GEMINI_CLI ||
    targetFormat === FORMATS.VERTEX
  ) {
    const body = isRecord(responseBody) ? responseBody : {};
    const response = (isRecord(body.response) ? body.response : body) as GeminiResponse;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate?.content;
    const usage = response.usageMetadata || (body.usageMetadata as GeminiUsage | undefined);
    let textContent = "",
      reasoningContent = "";
    const toolCalls: OpenAIToolCall[] = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;
        else if (part.text !== undefined) textContent += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: {
              name: part.functionCall.name || "",
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          });
        }
      }
    }

    const message: OpenAIAssistantMessage = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = (candidate?.finishReason || "stop").toLowerCase();
    if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

    const result: OpenAIChatCompletion = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{ index: 0, message, finish_reason: finishReason }],
    };

    if (usage) {
      result.usage = {
        prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0),
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      };
      if ((usage.thoughtsTokenCount || 0) > 0) {
        result.usage.completion_tokens_details = {
          reasoning_tokens: usage.thoughtsTokenCount || 0,
        };
      }
    }
    return result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
    const claudeBody = responseBody as ClaudeResponse;
    if (!claudeBody.content) return responseBody;

    let textContent = "",
      thinkingContent = "";
    const toolCalls: OpenAIToolCall[] = [];

    for (const block of claudeBody.content) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = block.text ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id || "",
          type: "function",
          function: { name: block.name || "", arguments: JSON.stringify(block.input || {}) },
        });
      }
    }

    const message: OpenAIAssistantMessage = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = claudeBody.stop_reason || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

    const result: OpenAIChatCompletion = {
      id: `chatcmpl-${claudeBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: claudeBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }],
    };

    if (claudeBody.usage) {
      result.usage = {
        prompt_tokens: claudeBody.usage.input_tokens || 0,
        completion_tokens: claudeBody.usage.output_tokens || 0,
        total_tokens: (claudeBody.usage.input_tokens || 0) + (claudeBody.usage.output_tokens || 0),
      };
    }
    return result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    return ollamaBodyToOpenAI(responseBody);
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 */
export async function handleNonStreamingResponse({
  providerResponse,
  provider,
  model,
  sourceFormat,
  targetFormat,
  body,
  stream,
  translatedBody,
  finalBody,
  requestStartTime,
  connectionId,
  apiKey,
  clientRawRequest,
  onRequestSuccess,
  reqLogger,
  toolNameMap,
  trackDone,
  appendLog,
  onFinalJsonResponse,
}: NonStreamingParams): Promise<NonStreamingResult> {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody: unknown;

  // Codex never sends Content-Type on success — detect by provider name too.
  // Codex returns Responses API SSE format, not Chat Completions SSE, so it
  // must be parsed with convertResponsesStreamToJson, not parseSSEToOpenAIResponse.
  const isCodexSSE = provider === "codex" || sourceFormat === FORMATS.OPENAI_RESPONSES;
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isCodexSSE);

  if (isSSE && isCodexSSE) {
    // Responses API SSE → convert to chat.completion JSON
    try {
      const jsonResponse = (await convertResponsesStreamToJson(
        providerResponse.body,
      )) as ResponsesJson;
      const inTokens = jsonResponse.usage?.input_tokens || 0;
      const outTokens = jsonResponse.usage?.output_tokens || 0;
      // Extract text from output items
      const msgItem = (jsonResponse.output || []).find((i) => i?.type === "message");
      const textContent =
        msgItem?.content?.find?.((c) => c.type === "output_text")?.text ||
        msgItem?.content?.find?.((c) => typeof c.text === "string")?.text ||
        "";
      responseBody = {
        id: jsonResponse.id || `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
        model,
        choices: [
          { index: 0, message: { role: "assistant", content: textContent }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: inTokens,
          completion_tokens: outTokens,
          total_tokens: inTokens + outTokens,
        },
      };
    } catch {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error("[ChatCore] Failed to parse Codex SSE response");
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        `Failed to parse Codex response from ${provider}`,
        undefined,
      );
    }
  } else if (isSSE) {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        "Invalid SSE response for non-streaming request",
        undefined,
      );
    }
    responseBody = parsed;
  } else {
    try {
      responseBody = await providerResponse.json();
    } catch {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error("[ChatCore] Failed to parse JSON response");
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        `Invalid JSON response from ${provider}`,
        undefined,
      );
    }
  }

  reqLogger.logProviderResponse(
    providerResponse.status,
    providerResponse.statusText,
    providerResponse.headers,
    responseBody,
  );
  if (onRequestSuccess) await onRequestSuccess();

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap);

  const usage = extractUsageFromResponse(responseBody);
  const detailsId = generateDetailId(model);
  appendLog({ tokens: usage, status: "SUCCESS", detailsId });
  saveUsageStats({
    provider,
    model,
    tokens: usage,
    connectionId,
    apiKey,
    endpoint: clientRawRequest?.endpoint,
  });

  const translatedResponse = (
    needsTranslation(targetFormat, sourceFormat)
      ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)
      : responseBody
  ) as MutableChatCompletion;

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if (translatedResponse?.choices?.[0]) {
    const choice = translatedResponse.choices[0];
    const msg = choice?.message;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls && choice && choice.finish_reason !== "tool_calls") {
      choice.finish_reason = "tool_calls";
    }
  }

  // Ensure OpenAI-required fields
  if (!translatedResponse.object) translatedResponse.object = "chat.completion";
  if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);
  if (!translatedResponse.system_fingerprint)
    translatedResponse.system_fingerprint = `fp_${Date.now().toString(36)}`;

  // Ensure logprobs is present in each choice (null when not requested)
  if (translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) {
      if (choice.logprobs === undefined) choice.logprobs = null;
    }
  }

  // Strip Azure-specific fields
  delete translatedResponse.prompt_filter_results;
  if (translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) delete choice.content_filter_results;
  }

  if (translatedResponse?.usage) {
    translatedResponse.usage = filterUsageForFormat(
      addBufferToUsage(translatedResponse.usage),
      sourceFormat,
    );
  }

  try {
    onFinalJsonResponse?.(translatedResponse, usage || translatedResponse?.usage || null);
  } catch {
    // best effort side-effects only
  }

  // Preserve reasoning_content so downstream clients can render thinking panels.

  reqLogger.logConvertedResponse(translatedResponse);

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(
    buildRequestDetail(
      {
        id: detailsId,
        provider,
        model,
        connectionId,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        providerResponse: responseBody || null,
        response: {
          content:
            translatedResponse?.choices?.[0]?.message?.content ||
            translatedResponse?.content ||
            null,
          thinking:
            translatedResponse?.choices?.[0]?.message?.reasoning_content ||
            translatedResponse?.reasoning_content ||
            null,
          finish_reason: translatedResponse?.choices?.[0]?.finish_reason || "unknown",
        },
        status: "success",
      },
      { endpoint: clientRawRequest?.endpoint || null },
    ),
  ).catch((err: unknown) => {
    console.error("[RequestDetail] Failed to save:", errorMessage(err));
  });

  return {
    success: true,
    response: new Response(JSON.stringify(translatedResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}
