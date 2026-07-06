import { appendRequestLog, trackPendingRequest } from "@/lib/usageDb";
import { CLAUDE_TOOL_SUFFIX } from "../config/appConstants.js";
import { FORMATS } from "../translator/formats.js";
import { initState, translateResponse } from "../translator/index.js";
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

function stripClaudeToolSuffixes(node) {
  if (!node || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((child) => {
      const mapped = stripClaudeToolSuffixes(child);
      if (mapped !== child) changed = true;
      return mapped;
    });
    return changed ? next : node;
  }

  if (
    node.type === "tool_use" &&
    typeof node.name === "string" &&
    node.name.endsWith(CLAUDE_TOOL_SUFFIX)
  ) {
    return { ...node, name: node.name.slice(0, -CLAUDE_TOOL_SUFFIX.length) };
  }

  let changed = false;
  const next = {};
  for (const key of Object.keys(node)) {
    const mapped = stripClaudeToolSuffixes(node[key]);
    if (mapped !== node[key]) changed = true;
    next[key] = mapped;
  }
  return changed ? next : node;
}

function decloakSSELine(line, toolNameMap, allowSuffixFallback = false) {
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
    return line;
  }
}

/**
 * Extract reasoning summary text from a reasoning_summary payload.
 * Supports both direct `{ content: "..." }` and nested `{ summary: { content: "..." } }` shapes.
 */
function extractReasoningSummaryText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const direct = typeof value.content === "string" ? value.content.trim() : "";
  if (direct.length > 0) return direct;

  const nested = value.summary;
  const nestedContent =
    nested &&
    typeof nested === "object" &&
    !Array.isArray(nested) &&
    typeof nested.content === "string"
      ? nested.content.trim()
      : "";
  return nestedContent.length > 0 ? nestedContent : null;
}

/**
 * Build an OpenAI-style chat.completion.chunk delta with reasoning_content
 * from a reasoning_summary envelope, so clients that consume delta.reasoning_content
 * (rather than top-level reasoning_summary) see the final summary.
 */
function buildReasoningSummaryCompatChunk(chunk, summaryText) {
  const compatChunk = {
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
};

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

export function createSSEStream(options = {}) {
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
  let usage = null;
  let stallTimer = null;
  let stallController = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state =
    mode === STREAM_MODE.TRANSLATE
      ? { ...initState(sourceFormat), provider, toolNameMap, model }
      : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let sawDone = false;
  const includeUsage = body?.stream_options?.include_usage === true;

  const allowSuffixFallback = provider === "claude";

  function emit(output, controller) {
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  }

  return new TransformStream({
    start(controller) {
      stallController = controller;
      const resetStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          const errChunk = `data: ${JSON.stringify({ error: { message: "Stream stalled: no data received for 5 minutes", type: "stream_stall", code: "stream_stall" } })}`;
          try {
            controller.enqueue(sharedEncoder.encode(errChunk + "\n\ndata: [DONE]\n\n"));
          } catch {}
          try {
            controller.terminate();
          } catch {}
        }, STALL_TIMEOUT_MS);
        stallTimer.unref?.();
      };
      resetStall();
      // Expose reset so transform can call it
      stallController._resetStall = resetStall;
    },

    transform(chunk, controller) {
      try {
        // Reset stall timer on each received chunk
        stallController?._resetStall?.();

        if (!ttftAt) {
          ttftAt = Date.now();
        }
        const text = decoder.decode(chunk, { stream: true });
        buffer += text;
        reqLogger?.appendProviderChunk?.(text);

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          lines[i] = decloakSSELine(lines[i], toolNameMap, allowSuffixFallback);
        }

        for (const line of lines) {
          const trimmed = line.trim();

          // Passthrough mode: normalize and forward
          if (mode === STREAM_MODE.PASSTHROUGH) {
            let output;
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
              } catch {}
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
          const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

          // Log OpenAI intermediate chunks (if available)
          if (translated?._openaiIntermediate) {
            for (const item of translated._openaiIntermediate) {
              const openaiOutput = formatSSE(item, FORMATS.OPENAI);
              reqLogger?.appendOpenAIChunk?.(openaiOutput);
            }
          }

          if (translated?.length > 0) {
            for (const item of translated) {
              // Filter empty chunks
              if (!hasValuableContent(item, sourceFormat)) {
                continue; // Skip this empty chunk
              }

              // Inject estimated usage if finish chunk has no valid usage
              const isFinishChunk =
                item.type === "message_delta" || item.choices?.[0]?.finish_reason;
              if (includeUsage) {
                if (
                  state.finishReason &&
                  isFinishChunk &&
                  !hasValidUsage(item.usage) &&
                  totalContentLength > 0
                ) {
                  const estimated = estimateUsage(body, totalContentLength, sourceFormat);
                  item.usage = filterUsageForFormat(estimated, sourceFormat);
                  state.usage = estimated;
                } else if (state.finishReason && isFinishChunk && state.usage) {
                  const buffered = addBufferToUsage(state.usage);
                  item.usage = filterUsageForFormat(buffered, sourceFormat);
                }
              }

              emit(formatSSE(item, sourceFormat), controller);
            }
          }
        }
      } catch (_transformError) {
        console.error("[STREAM_TRANSFORM] Transform error; attempting graceful termination");
        try {
          controller.enqueue(
            sharedEncoder.encode(
              `data: ${JSON.stringify({ error: { message: "Stream processing error", type: "server_error" } })}\n\ndata: [DONE]\n\n`,
            ),
          );
        } catch {}
        try {
          controller.terminate();
        } catch {}
      }
    },

    flush(controller) {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      trackPendingRequest(model, provider, connectionId, false);
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
              model,
              provider,
              connectionId,
              tokens: null,
              status: "SUCCESS",
            }).catch(() => {});
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
            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                emit(formatSSE(item, sourceFormat), controller);
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            emit(formatSSE(item, sourceFormat), controller);
          }
        }

        emit("data: [DONE]\n\n", controller);

        if (!hasValidUsage(state?.usage) && totalContentLength > 0) {
          state.usage = estimateUsage(body, totalContentLength, sourceFormat);
        }

        if (hasValidUsage(state?.usage)) {
          logUsage(state.provider || targetFormat, state.usage, model, connectionId, apiKey);
        } else {
          appendRequestLog({
            model,
            provider,
            connectionId,
            tokens: null,
            status: "SUCCESS",
          }).catch(() => {});
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
      } catch (_error) {
        console.log("Error in flush");
      }
    },
  });
}

export function createSSETransformStreamWithLogger(
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
  provider = null,
  reqLogger = null,
  model = null,
  connectionId = null,
  body = null,
  onStreamComplete = null,
  apiKey = null,
  sourceFormat = null,
  toolNameMap = null,
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
