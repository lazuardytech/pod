import { generateDetailId, saveRequestDetail } from "@/lib/usageDb";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { createErrorResult } from "../../utils/error.js";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking.js";
import {
  buildRequestDetail,
  extractRequestConfig,
  extractUsageFromResponse,
  saveUsageStats,
} from "./requestDetail.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";

type NonStreamingResult =
  | { success: true; response: Response }
  | ReturnType<typeof createErrorResult>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */
export function translateNonStreamingResponse(
  responseBody: any,
  targetFormat: any,
  sourceFormat: any,
) {
  if (targetFormat === sourceFormat || targetFormat === FORMATS.OPENAI) return responseBody;

  // Gemini / Antigravity
  if (
    targetFormat === FORMATS.GEMINI ||
    targetFormat === FORMATS.ANTIGRAVITY ||
    targetFormat === FORMATS.GEMINI_CLI ||
    targetFormat === FORMATS.VERTEX
  ) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;
    let textContent = "",
      reasoningContent = "";
    const toolCalls: any[] = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;
        else if (part.text !== undefined) textContent += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args || {}),
            },
          });
        }
      }
    }

    const message: any = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = (candidate.finishReason || "stop").toLowerCase();
    if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

    const result: any = {
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
      if (usage.thoughtsTokenCount > 0) {
        result.usage.completion_tokens_details = { reasoning_tokens: usage.thoughtsTokenCount };
      }
    }
    return result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
    if (!responseBody.content) return responseBody;

    let textContent = "",
      thinkingContent = "";
    const toolCalls: any[] = [];

    for (const block of responseBody.content) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = block.text ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
        });
      }
    }

    const message: any = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = responseBody.stop_reason || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

    const result: any = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }],
    };

    if (responseBody.usage) {
      result.usage = {
        prompt_tokens: responseBody.usage.input_tokens || 0,
        completion_tokens: responseBody.usage.output_tokens || 0,
        total_tokens:
          (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0),
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
}: any): Promise<NonStreamingResult> {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody;

  // Codex never sends Content-Type on success — detect by provider name too.
  // Codex returns Responses API SSE format, not Chat Completions SSE, so it
  // must be parsed with convertResponsesStreamToJson, not parseSSEToOpenAIResponse.
  const isCodexSSE = provider === "codex" || sourceFormat === FORMATS.OPENAI_RESPONSES;
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isCodexSSE);

  if (isSSE && isCodexSSE) {
    // Responses API SSE → convert to chat.completion JSON
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body);
      const inTokens = jsonResponse.usage?.input_tokens || 0;
      const outTokens = jsonResponse.usage?.output_tokens || 0;
      // Extract text from output items
      const msgItem = (jsonResponse.output || []).find((i: any) => i?.type === "message");
      const textContent =
        msgItem?.content?.find?.((c: any) => c.type === "output_text")?.text ||
        msgItem?.content?.find?.((c: any) => typeof c.text === "string")?.text ||
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

  const translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)
    : responseBody;

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if (translatedResponse?.choices?.[0]) {
    const choice = translatedResponse.choices[0];
    const msg = choice.message;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls && choice.finish_reason !== "tool_calls") {
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
