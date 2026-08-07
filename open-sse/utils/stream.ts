// @ts-nocheck
import { appendRequestLog, trackPendingRequest } from "@/lib/usageDb";
import { CLAUDE_TOOL_SUFFIX } from "../config/appConstants.js";
import { FORMATS } from "../translator/formats.js";
import { initState, translateResponse } from "../translator/index.js";
import type { TranslatorState } from "../translator/registry.js";
import { decloakToolNames } from "./claudeCloaking.js";
import { fixInvalidId, formatSSE, hasValuableContent, parseSSELine } from "./streamHelpers.js";
import {
  addBufferToUsage,
  COLORS,
  estimateUsage,
  extractUsage,
  filterUsageForFormat,
  hasValidUsage,
  logUsage,
} from "./usageTracking.js";

export { COLORS, formatSSE };

type JsonRecord = Record<string, unknown>;
type MutableStreamChunk = JsonRecord & {
  choices?: Array<{ finish_reason?: unknown }>;
  type?: unknown;
  usage?: unknown;
};

type RequestLogger = {
  appendConvertedChunk?: (chunk: string) => void;
  appendOpenAIChunk?: (chunk: string) => void;
  appendProviderChunk?: (chunk: string) => void;
};

type StreamCompleteHandler = (
  result: { content: string; thinking: string },
  usage: unknown,
  ttftAt: number | null,
) => void;

type SSEStreamOptions = {
  apiKey?: string | null;
  body?: JsonRecord | null;
  connectionId?: string | null;
  mode?: (typeof STREAM_MODE)[keyof typeof STREAM_MODE];
  model?: string | null;
  onStreamComplete?: StreamCompleteHandler | null;
  provider?: string | null;
  reqLogger?: RequestLogger | null;
  sourceFormat?: string | null;
  targetFormat?: string | null;
  toolNameMap?: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripClaudeToolSuffixes(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((child: unknown): unknown => {
      const mapped = stripClaudeToolSuffixes(child);
      if (mapped !== child) changed = true;
      return mapped;
    });
    return changed ? next : node;
  }

  if (
    "type" in node &&
    "name" in node &&
    node.type === "tool_use" &&
    typeof node.name === "string" &&
    node.name.endsWith(CLAUDE_TOOL_SUFFIX)
  ) {
    return { ...node, name: node.name.slice(0, -CLAUDE_TOOL_SUFFIX.length) };
  }

  let changed = false;
  const record = node as JsonRecord;
  const next: JsonRecord = {};
  for (const key of Object.keys(node)) {
    const mapped = stripClaudeToolSuffixes(record[key]);
    if (mapped !== record[key]) changed = true;
    next[key] = mapped;
  }
  return changed ? next : node;
}

function decloakSSELine(line: string, toolNameMap: unknown, allowSuffixFallback = false) {
  if (!line.includes("tool_use")) return line;

  const isDataLine = line.startsWith("data:");
  const payload = isDataLine ? line.slice(5).trim() : line.trim();
  if (!payload || payload === "[DONE]" || !payload.startsWith("{")) return line;

  try {
    const parsed = JSON.parse(payload);
    let decloaked = decloakToolNames(parsed, toolNameMap);
    if (decloaked === parsed && allowSuffixFallback) {
      decloaked = stripClaudeToolSuffixes(parsed);
    }
    if (decloaked === parsed) return line;
    return (isDataLine ? "data: " : "") + JSON.stringify(decloaked);
  } catch {
    // Malformed SSE data should pass through unchanged.
    return line;
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Extract reasoning summary text from a reasoning_summary payload.
 * Supports both direct `{ content: "..." }` and nested `{ summary: { content: "..." } }` shapes.
 */
function extractReasoningSummaryText(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const direct = typeof value.content === "string" ? value.content.trim() : "";
  if (direct.length > 0) return direct;

  const nested = value.summary;
  const nestedContent =
    isRecord(nested) && typeof nested.content === "string" ? nested.content.trim() : "";
  return nestedContent.length > 0 ? nestedContent : null;
}

/**
 * Build an OpenAI-style chat.completion.chunk delta with reasoning_content
 * from a reasoning_summary envelope, so clients that consume delta.reasoning_content
 * (rather than top-level reasoning_summary) see the final summary.
 */
function buildReasoningSummaryCompatChunk(chunk: JsonRecord, summaryText: string) {
  const compatChunk: JsonRecord = {
    id:
      typeof chunk.id === "string" && chunk.id.trim().length > 0
        ? chunk.id
        : `chatcmpl-${Date.now()}`,
    object:
      typeof chunk.object === "string" && chunk.object.trim().length > 0
        ? chunk.object
        : "chat.completion.chunk",
    created:
      typeof chunk.created === "number" && Number.isFinite(chunk.created)
        ? chunk.created
        : Math.floor(Date.now() / 1000),
    model:
      typeof chunk.model === "string" && chunk.model.trim().length > 0 ? chunk.model : "unknown",
    choices: [
      {
        index: 0,
        delta: { reasoning_content: summaryText },
        finish_reason: null,
      },
    ],
  };

  if (chunk.system_fingerprint !== undefined) {
    compatChunk.system_fingerprint = chunk.system_fingerprint;
  }

  return compatChunk;
}

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate", // Full translation between formats
  PASSTHROUGH: "passthrough", // No translation, normalize output, extract usage
} as const;

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes (content, usage)
 * @param {string} options.apiKey - API key for usage tracking
 */
const STALL_TIMEOUT_MS = 300_000; // 5 minutes

export function createSSEStream(options: SSEStreamOptions = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null,
  } = options;

  let buffer = "";
  let usage: unknown = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let resetStallTimer: (() => void) | null = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state: TranslatorState =
    mode === STREAM_MODE.TRANSLATE
      ? { ...initState(sourceFormat!), provider, toolNameMap, model }
      : {};

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt: number | null = null;
  let sawDone = false;
  const streamOptions = isRecord(body?.stream_options) ? body.stream_options : null;
  const includeUsage = streamOptions?.include_usage === true;

  const allowSuffixFallback = provider === "claude";

  function emit(output: string, controller: TransformStreamDefaultController<Uint8Array>) {
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          const errChunk = `data: ${JSON.stringify({ error: { message: "Stream stalled: no data received for 5 minutes", type: "stream_stall", code: "stream_stall" } })}`;
          try {
            controller.enqueue(sharedEncoder.encode(errChunk + "\n\ndata: [DONE]\n\n"));
          } catch {
            // Client may already be gone; stall cleanup remains best effort.
          }
          try {
            controller.terminate();
          } catch {
            // Stream may already be closed by client disconnect.
          }
        }, STALL_TIMEOUT_MS);
        stallTimer.unref?.();
      };
      resetStallTimer();
    },

    transform(chunk, controller) {
      try {
        // Reset stall timer on each received chunk
        resetStallTimer?.();

        if (!ttftAt) {
          ttftAt = Date.now();
        }
        const text = decoder.decode(chunk, { stream: true });
        buffer += text;
        reqLogger?.appendProviderChunk?.(text);

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          lines[i] = decloakSSELine(lines[i] ?? "", toolNameMap, allowSuffixFallback);
        }

        for (const line of lines) {
          const trimmed = line.trim();

          // Passthrough mode: normalize and forward
          if (mode === STREAM_MODE.PASSTHROUGH) {
            let output = "";
            let injectedUsage = false;

            if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim());

                const idFixed = fixInvalidId(parsed);

                // Reasoning summary forwarding: mirror top-level reasoning_summary envelope to
                // an OpenAI-style delta.reasoning_content chunk for clients that don't consume
                // the summary envelope directly.
                const summaryText = extractReasoningSummaryText(parsed.reasoning_summary);
                const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] || {} : {};
                const firstDelta = (firstChoice && firstChoice.delta) || {};
                const hasTextDelta =
                  typeof firstDelta.content === "string" && firstDelta.content.length > 0;
                const hasReasoningDelta =
                  typeof firstDelta.reasoning_content === "string" &&
                  firstDelta.reasoning_content.length > 0;
                const hasToolDelta =
                  Array.isArray(firstDelta.tool_calls) && firstDelta.tool_calls.length > 0;
                const hasFinishReason =
                  typeof firstChoice.finish_reason === "string" &&
                  firstChoice.finish_reason.length > 0;

                if (
                  summaryText &&
                  !hasTextDelta &&
                  !hasReasoningDelta &&
                  !hasToolDelta &&
                  !hasFinishReason
                ) {
                  const compatChunk = buildReasoningSummaryCompatChunk(parsed, summaryText);
                  const compatOutput = `data: ${JSON.stringify(compatChunk)}\n\n`;
                  accumulatedThinking += summaryText;
                  totalContentLength += summaryText.length;
                  reqLogger?.appendConvertedChunk?.(compatOutput);
                  controller.enqueue(sharedEncoder.encode(compatOutput));
                }

                // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
                let fieldsInjected = false;
                if (parsed.choices !== undefined) {
                  if (!parsed.object) {
                    parsed.object = "chat.completion.chunk";
                    fieldsInjected = true;
                  }
                  if (!parsed.created) {
                    parsed.created = Math.floor(Date.now() / 1000);
                    fieldsInjected = true;
                  }
                  // Ensure logprobs on each choice (null when not present)
                  for (const choice of parsed.choices) {
                    if (choice.logprobs === undefined) {
                      choice.logprobs = null;
                      fieldsInjected = true;
                    }
                  }
                }

                // Strip Azure-specific non-standard fields from streaming chunks
                if (parsed.prompt_filter_results !== undefined) {
                  delete parsed.prompt_filter_results;
                  fieldsInjected = true;
                }
                if (parsed?.choices) {
                  for (const choice of parsed.choices) {
                    if (choice.content_filter_results !== undefined) {
                      delete choice.content_filter_results;
                      fieldsInjected = true;
                    }
                  }
                }

                // Error payload mid-stream: if we already sent content, skip it
                // to avoid corrupting the stream. If no content yet, forward as-is
                // so downstream can detect and handle it.
                if (parsed.error && !parsed.choices) {
                  if (totalContentLength > 0) {
                    // Already sent content — silently drop error and close stream
                    continue;
                  }
                  output = `data: ${JSON.stringify(parsed)}\n\n`;
                  emit(output, controller);
                  continue;
                }

                if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
                  continue;
                }

                const delta = parsed.choices?.[0]?.delta;
                const content = delta?.content;
                const reasoning = delta?.reasoning_content;
                if (content && typeof content === "string") {
                  totalContentLength += content.length;
                  accumulatedContent += content;
                }
                if (reasoning && typeof reasoning === "string") {
                  totalContentLength += reasoning.length;
                  accumulatedThinking += reasoning;
                }

                const extracted = extractUsage(parsed);
                if (extracted) {
                  usage = extracted;
                }

                const isFinishChunk = parsed.choices?.[0]?.finish_reason;
                if (includeUsage) {
                  if (isFinishChunk && !hasValidUsage(parsed.usage)) {
                    const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
                    parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                    output = `data: ${JSON.stringify(parsed)}\n\n`;
                    usage = estimated;
                    injectedUsage = true;
                  } else if (isFinishChunk && usage) {
                    const buffered = addBufferToUsage(usage);
                    parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
                    output = `data: ${JSON.stringify(parsed)}\n\n`;
                    injectedUsage = true;
                  }
                } else if (idFixed || fieldsInjected) {
                  output = `data: ${JSON.stringify(parsed)}\n\n`;
                  injectedUsage = true;
                }
              } catch {
                // Malformed passthrough chunks are forwarded in their original form.
              }
            }

            if (!injectedUsage) {
              if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
                sawDone = true;
              }
              if (line.startsWith("data:") && !line.startsWith("data: ")) {
                output = "data: " + line.slice(5) + "\n\n";
              } else {
                output = line + "\n\n";
              }
            }

            emit(output, controller);
            continue;
          }

          // Translate mode
          if (!trimmed) continue;

          const parsed = parseSSELine(trimmed, targetFormat);
          if (!parsed) continue;

          // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
          // For other formats: done=true is the [DONE] sentinel, skip
          if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
            emit("data: [DONE]\n\n", controller);
            continue;
          }

          // Claude format - content
          if (parsed.delta?.text) {
            totalContentLength += parsed.delta.text.length;
            accumulatedContent += parsed.delta.text;
          }
          // Claude format - thinking
          if (parsed.delta?.thinking) {
            totalContentLength += parsed.delta.thinking.length;
            accumulatedThinking += parsed.delta.thinking;
          }

          // OpenAI format - content
          if (parsed.choices?.[0]?.delta?.content) {
            totalContentLength += parsed.choices[0].delta.content.length;
            accumulatedContent += parsed.choices[0].delta.content;
          }
          // OpenAI format - reasoning
          if (parsed.choices?.[0]?.delta?.reasoning_content) {
            totalContentLength += parsed.choices[0].delta.reasoning_content.length;
            accumulatedThinking += parsed.choices[0].delta.reasoning_content;
          }

          // Gemini format
          if (parsed.candidates?.[0]?.content?.parts) {
            for (const part of parsed.candidates[0].content.parts) {
              if (part.text && typeof part.text === "string") {
                totalContentLength += part.text.length;
                // Check if this is thinking content
                if (part.thought === true) {
                  accumulatedThinking += part.text;
                } else {
                  accumulatedContent += part.text;
                }
              }
            }
          }

          // Extract usage
          const extracted = extractUsage(parsed);
          if (extracted) state.usage = extracted; // Keep original usage for logging

          // Translate: targetFormat -> openai -> sourceFormat
          const translated = translateResponse(targetFormat!, sourceFormat!, parsed, state);

          // Log OpenAI intermediate chunks (if available)
          if (translated?._openaiIntermediate) {
            for (const item of translated._openaiIntermediate) {
              const openaiOutput = formatSSE(item, FORMATS.OPENAI);
              reqLogger?.appendOpenAIChunk?.(openaiOutput);
            }
          }

          if (translated?.length > 0) {
            for (const item of translated) {
              const streamItem = item as MutableStreamChunk;
              // Filter empty chunks
              if (!hasValuableContent(streamItem, sourceFormat!)) {
                continue; // Skip this empty chunk
              }

              // Inject estimated usage if finish chunk has no valid usage
              const isFinishChunk =
                streamItem.type === "message_delta" || streamItem.choices?.[0]?.finish_reason;
              if (includeUsage) {
                if (
                  state.finishReason &&
                  isFinishChunk &&
                  !hasValidUsage(streamItem.usage) &&
                  totalContentLength > 0
                ) {
                  const estimated = estimateUsage(body, totalContentLength, sourceFormat!);
                  streamItem.usage = filterUsageForFormat(estimated, sourceFormat!);
                  state.usage = estimated;
                } else if (state.finishReason && isFinishChunk && state.usage) {
                  const buffered = addBufferToUsage(state.usage);
                  streamItem.usage = filterUsageForFormat(buffered, sourceFormat!);
                }
              }

              emit(formatSSE(streamItem, sourceFormat!), controller);
            }
          }
        }
      } catch (transformError: unknown) {
        console.error(
          isAbortError(transformError)
            ? "[STREAM_TRANSFORM] Transform aborted; attempting graceful termination"
            : "[STREAM_TRANSFORM] Transform error; attempting graceful termination",
        );
        try {
          controller.enqueue(
            sharedEncoder.encode(
              `data: ${JSON.stringify({ error: { message: "Stream processing error", type: "server_error" } })}\n\ndata: [DONE]\n\n`,
            ),
          );
        } catch {
          // Client may already be disconnected; error frame is best effort.
        }
        try {
          controller.terminate();
        } catch {
          // Stream may already be closed after abort/error.
        }
      }
    },

    flush(controller) {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      trackPendingRequest(model || "", provider || "", connectionId || "", false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            const decloaked = decloakSSELine(buffer, toolNameMap, allowSuffixFallback);
            let output = decloaked;
            if (decloaked.startsWith("data:") && !decloaked.startsWith("data: ")) {
              output = "data: " + decloaked.slice(5);
            }
            if (!output.endsWith("\n\n")) output += "\n\n";
            emit(output, controller);
          }

          if (!hasValidUsage(usage) && totalContentLength > 0) {
            usage = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
          }

          if (hasValidUsage(usage)) {
            logUsage(provider, usage, model, connectionId, apiKey);
          } else {
            appendRequestLog({
              model: model ?? undefined,
              provider: provider ?? undefined,
              connectionId: connectionId ?? undefined,
              tokens: null,
              status: "SUCCESS",
            }).catch(() => {
              // Best-effort usage log; do not fail stream flush.
            });
          }

          if (!sawDone) emit("data: [DONE]\n\n", controller);

          if (onStreamComplete) {
            onStreamComplete(
              {
                content: accumulatedContent,
                thinking: accumulatedThinking,
              },
              usage,
              ttftAt,
            );
          }
          return;
        }

        if (buffer.trim()) {
          const decloaked = decloakSSELine(buffer, toolNameMap, allowSuffixFallback);
          const parsed = parseSSELine(decloaked.trim());
          if (parsed && !parsed.done) {
            const translated = translateResponse(targetFormat!, sourceFormat!, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                emit(formatSSE(item, sourceFormat!), controller);
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat!, sourceFormat!, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            emit(formatSSE(item, sourceFormat!), controller);
          }
        }

        emit("data: [DONE]\n\n", controller);

        if (!hasValidUsage(state?.usage) && totalContentLength > 0) {
          state.usage = estimateUsage(body, totalContentLength, sourceFormat!);
        }

        if (hasValidUsage(state?.usage)) {
          logUsage(state.provider || targetFormat, state.usage, model, connectionId, apiKey);
        } else {
          appendRequestLog({
            model: model ?? undefined,
            provider: provider ?? undefined,
            connectionId: connectionId ?? undefined,
            tokens: null,
            status: "SUCCESS",
          }).catch(() => {
            // Best-effort usage log; do not fail stream flush.
          });
        }

        if (onStreamComplete) {
          onStreamComplete(
            {
              content: accumulatedContent,
              thinking: accumulatedThinking,
            },
            state?.usage,
            ttftAt,
          );
        }
      } catch (error: unknown) {
        if (isAbortError(error)) {
          console.log("Stream flush aborted");
          return;
        }
        console.log("Error in flush");
      }
    },
  });
}

export function createSSETransformStreamWithLogger(
  targetFormat: string,
  sourceFormat: string,
  provider: string | null = null,
  reqLogger: RequestLogger | null = null,
  toolNameMap: unknown = null,
  model: string | null = null,
  connectionId: string | null = null,
  body: JsonRecord | null = null,
  onStreamComplete: StreamCompleteHandler | null = null,
  apiKey: string | null = null,
) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
  });
}

export function createPassthroughStreamWithLogger(
  provider: string | null = null,
  reqLogger: RequestLogger | null = null,
  model: string | null = null,
  connectionId: string | null = null,
  body: JsonRecord | null = null,
  onStreamComplete: StreamCompleteHandler | null = null,
  apiKey: string | null = null,
  sourceFormat: string | null = null,
  toolNameMap: unknown = null,
) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
  });
}
