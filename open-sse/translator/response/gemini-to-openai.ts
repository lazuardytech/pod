import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";

interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
  mime_type?: string;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: unknown;
  thought_signature?: unknown;
  functionCall?: GeminiFunctionCall;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiUsageMetadata {
  cachedContentTokenCount?: unknown;
  promptTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  totalTokenCount?: unknown;
}

/** Gemini chunk, or an Antigravity wrapper carrying it under `response`. */
interface GeminiResponseChunk {
  response?: GeminiResponseChunk;
  candidates?: GeminiCandidate[];
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: GeminiUsageMetadata;
}

interface OpenAIToolCallChunk {
  id: string;
  index: number;
  type: string;
  function: { name: string; arguments: string };
}

interface OpenAIUsageSummary {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

interface GeminiTranslatorState {
  messageId: string;
  model: string;
  functionIndex: number;
  toolCalls: Map<number, OpenAIToolCallChunk>;
  toolNameMap?: Map<string, string>;
  usage?: OpenAIUsageSummary;
  finishReason?: string;
}

// Convert Gemini response chunk to OpenAI format
export function geminiToOpenAIResponse(chunk: unknown, state: unknown) {
  if (!chunk) return null;

  const c = chunk as GeminiResponseChunk;
  const s = state as GeminiTranslatorState;

  // Handle Antigravity wrapper
  const response = c.response || c;
  if (!response || !response.candidates?.[0]) return null;

  const results = [];
  const candidate = response.candidates[0] as GeminiCandidate;
  const content = candidate.content;

  // Initialize state
  if (!s.messageId) {
    s.messageId = response.responseId || `msg_${Date.now()}`;
    s.model = response.modelVersion || "gemini";
    s.functionIndex = 0;
    results.push({
      id: `chatcmpl-${s.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: s.model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null,
        },
      ],
    });
  }

  // Process parts
  if (content?.parts) {
    for (const part of content.parts) {
      const hasThoughtSig = part.thoughtSignature || part.thought_signature;
      const isThought = part.thought === true;

      // Handle thought signature (thinking mode)
      if (hasThoughtSig) {
        const hasTextContent = part.text !== undefined && part.text !== "";
        const hasFunctionCall = !!part.functionCall;

        if (hasTextContent) {
          results.push({
            id: `chatcmpl-${s.messageId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: s.model,
            choices: [
              {
                index: 0,
                delta: isThought ? { reasoning_content: part.text } : { content: part.text },
                finish_reason: null,
              },
            ],
          });
        }

        if (hasFunctionCall) {
          const rawName = part.functionCall!.name;
          // Restore original tool name from mapping (AG cloaking)
          const fcName = s.toolNameMap?.get(rawName) || rawName;
          const fcArgs = part.functionCall!.args || {};
          const toolCallIndex = s.functionIndex++;

          const toolCall = {
            id: `${fcName}-${Date.now()}-${toolCallIndex}`,
            index: toolCallIndex,
            type: "function",
            function: {
              name: fcName,
              arguments: JSON.stringify(fcArgs),
            },
          };

          s.toolCalls.set(toolCallIndex, toolCall);

          results.push({
            id: `chatcmpl-${s.messageId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: s.model,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [toolCall] },
                finish_reason: null,
              },
            ],
          });
        }
        continue;
      }

      // Text content (non-thinking)
      if (part.text !== undefined && part.text !== "") {
        results.push({
          id: `chatcmpl-${s.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: s.model,
          choices: [
            {
              index: 0,
              delta: { content: part.text },
              finish_reason: null,
            },
          ],
        });
      }

      // Function call
      if (part.functionCall) {
        const rawName = part.functionCall.name;
        // Restore original tool name from mapping (AG cloaking)
        const fcName = s.toolNameMap?.get(rawName) || rawName;
        const fcArgs = part.functionCall.args || {};
        const toolCallIndex = s.functionIndex++;

        const toolCall = {
          id: `${fcName}-${Date.now()}-${toolCallIndex}`,
          index: toolCallIndex,
          type: "function",
          function: {
            name: fcName,
            arguments: JSON.stringify(fcArgs),
          },
        };

        s.toolCalls.set(toolCallIndex, toolCall);

        results.push({
          id: `chatcmpl-${s.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: s.model,
          choices: [
            {
              index: 0,
              delta: { tool_calls: [toolCall] },
              finish_reason: null,
            },
          ],
        });
      }

      // Inline data (images)
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
        results.push({
          id: `chatcmpl-${s.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: s.model,
          choices: [
            {
              index: 0,
              delta: {
                images: [
                  {
                    type: "image_url",
                    image_url: { url: `data:${mimeType};base64,${inlineData.data}` },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
      }
    }
  }

  // Usage metadata - extract before finish reason so we can include it
  const usageMeta = response.usageMetadata || c.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    const cachedTokens =
      typeof usageMeta.cachedContentTokenCount === "number" ? usageMeta.cachedContentTokenCount : 0;
    const promptTokenCountRaw =
      typeof usageMeta.promptTokenCount === "number" ? usageMeta.promptTokenCount : 0;
    const thoughtsTokens =
      typeof usageMeta.thoughtsTokenCount === "number" ? usageMeta.thoughtsTokenCount : 0;
    let candidatesTokens =
      typeof usageMeta.candidatesTokenCount === "number" ? usageMeta.candidatesTokenCount : 0;
    const totalTokens =
      typeof usageMeta.totalTokenCount === "number" ? usageMeta.totalTokenCount : 0;

    // prompt_tokens = promptTokenCount (includes cached tokens, matching claude-to-openai.js behavior)
    const promptTokens = promptTokenCountRaw;

    // Fallback calculation if candidatesTokenCount is 0 but totalTokenCount exists
    if (candidatesTokens === 0 && totalTokens > 0) {
      candidatesTokens = totalTokens - promptTokenCountRaw - thoughtsTokens;
      if (candidatesTokens < 0) candidatesTokens = 0;
    }

    // completion_tokens = candidatesTokenCount + thoughtsTokenCount (match Go code)
    const completionTokens = candidatesTokens + thoughtsTokens;

    s.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    };

    // Add prompt_tokens_details if cached tokens exist
    if (cachedTokens > 0) {
      s.usage.prompt_tokens_details = {
        cached_tokens: cachedTokens,
      };
    }

    // Add completion_tokens_details if reasoning tokens exist
    if (thoughtsTokens > 0) {
      s.usage.completion_tokens_details = {
        reasoning_tokens: thoughtsTokens,
      };
    }
  }

  // Finish reason - include usage in final chunk
  if (candidate.finishReason) {
    let finishReason = candidate.finishReason.toLowerCase();
    if (finishReason === "stop" && s.toolCalls.size > 0) {
      finishReason = "tool_calls";
    }

    const finalChunk: Record<string, unknown> = {
      id: `chatcmpl-${s.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: s.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    };

    // Include usage in final chunk for downstream translators
    if (s.usage) {
      finalChunk.usage = s.usage;
    }

    results.push(finalChunk);
    s.finishReason = finishReason;
  }

  return results.length > 0 ? results : null;
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.VERTEX, FORMATS.OPENAI, null, geminiToOpenAIResponse);
