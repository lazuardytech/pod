import { v4 as uuidv4 } from "uuid";
import { isTransientErrorBody } from "../config/errorConfig.js";
import { PROVIDERS } from "../config/providers.js";
import { DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";
import { refreshKiroToken } from "../services/tokenRefresh.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { BaseExecutor } from "./base.js";

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials: any, stream: any = true) {
    const headers = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": uuidv4(),
    };

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    return headers;
  }

  transformRequest(model: any, body: any, stream: any, credentials: any) {
    return body;
  }

  /**
   * Custom execute for Kiro - handles AWS EventStream binary response with retry support
   *
   * Retry strategy (in-request, before falling back to next account):
   *   - 429 / 502 / 503: standard status-based retry from retryConfig
   *   - 500 with transient body (e.g. MODEL_TEMPORARILY_UNAVAILABLE,
   *     "unexpectedly high load"): treated as retryable. AWS CodeWhisperer
   *     surfaces overload as HTTP 500 with a reason code in the body, so a
   *     plain 500 retry would be unsafe but a body-gated one is.
   *   - Generic 500 without transient body: not retried (would mask real bugs).
   *
   * Delay uses exponential backoff with jitter: base * 2^attempt * (0.5..1.5)
   * to avoid synchronized retries hammering an already-degraded upstream.
   */
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: any) {
    const url = this.buildUrl(model, stream, 0);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    let retryAttempts = 0;
    let transientAttempts = 0;

    // Body-gated retry budget for HTTP 500 with transient reason codes.
    // Kept separate from status-based retryConfig because a plain 500 retry
    // would be dangerous (could mask client-side bugs); we only retry when the
    // body explicitly signals "server busy".
    const transientRetry = this.config.transientRetry || {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
    };

    // Abort-aware sleep helper
    const sleep = (ms: any, signal: any) =>
      new Promise((resolve: any, reject: any) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });

    // Calculate jittered delay: exponential backoff with 50%–150% jitter
    const jitteredDelay = (baseMs: any, attempt: any) => {
      const exponential = baseMs * 2 ** attempt;
      const capped = Math.min(exponential, transientRetry.maxDelayMs || 8000);
      return Math.round(capped * (0.5 + Math.random()));
    };

    while (true) {
      const headers = this.buildHeaders(credentials, stream);

      const response = await proxyAwareFetch(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal,
        },
        proxyOptions,
      );

      // Check if should retry based on status code (existing path)
      const { attempts: maxRetries, delayMs } = resolveRetryEntry(retryConfig[response.status]);
      if (!response.ok && maxRetries > 0 && retryAttempts < maxRetries) {
        retryAttempts++;
        log?.debug?.(
          "RETRY",
          `${response.status} retry ${retryAttempts}/${maxRetries} after ${delayMs / 1000}s`,
        );
        await sleep(delayMs, signal);
        continue;
      }

      // Body-gated retry for transient 500/503 (e.g. MODEL_TEMPORARILY_UNAVAILABLE).
      // We need to peek the body to decide — clone the response so the original
      // can still be returned/streamed if we choose not to retry.
      if (
        !response.ok &&
        (response.status === 500 || response.status === 503) &&
        transientAttempts < (transientRetry.attempts || 0)
      ) {
        let bodyText = "";
        try {
          // Use a clone so consuming the body here doesn't break the fallback path
          bodyText = await response.clone().text();
        } catch {
          bodyText = "";
        }

        if (isTransientErrorBody(bodyText)) {
          if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          transientAttempts++;
          log?.warn?.(
            "RETRY",
            `KIRO ${response.status} transient (${transientAttempts}/${transientRetry.attempts}) | ${bodyText.slice(0, 120)}`,
          );
          await sleep(
            jitteredDelay(transientRetry.baseDelayMs || 1000, transientAttempts - 1),
            signal,
          );
          continue;
        }
      }

      if (!response.ok) {
        return { response, url, headers, transformedBody };
      }

      // Success - transform and return
      // For Kiro, we need to transform the binary EventStream to SSE
      // Create a TransformStream to convert binary to SSE text
      const transformedResponse = this.transformEventStreamToSSE(response, model);
      return { response: transformedResponse, url, headers, transformedBody };
    }
  }

  /**
   * Transform AWS EventStream binary response to SSE text stream
   * Using TransformStream instead of ReadableStream.pull() to avoid Workers timeout
   */
  transformEventStreamToSSE(response: any, model: any) {
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const state: any = {
      endDetected: false,
      finishEmitted: false,
      hasToolCalls: false,
      toolCallIndex: 0,
      seenToolIds: new Map(),
      messageStopEvent: false,
      hasMeteringEvent: false,
      hasContextUsage: false,
      totalContentLength: 0,
      contextUsagePercentage: 0,
    };

    // Pipe response body through transform stream
    if (!response.body) {
      return new Response("data: [DONE]\n\n", {
        status: response.status,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    let upstreamReader: any = null;

    // Event parsing logic - called from start() for each chunk
    const processChunk = async (chunk: any, controller: any) => {
      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + chunk.length);
      newBuffer.set(buffer);
      newBuffer.set(chunk, buffer.length);
      buffer = newBuffer;

      // Parse events from buffer
      let iterations = 0;
      const maxIterations = 1000;
      while (buffer.length >= 16 && iterations < maxIterations) {
        iterations++;
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const totalLength = view.getUint32(0, false);

        if (totalLength < 16 || totalLength > buffer.length || buffer.length < totalLength) break;

        const eventData = buffer.slice(0, totalLength);
        buffer = buffer.slice(totalLength);

        const event = parseEventFrame(eventData);
        if (!event) continue;

        const eventType = event.headers[":event-type"] || "";

        // Track total content length for token estimation
        if (!state.totalContentLength) state.totalContentLength = 0;
        if (!state.contextUsagePercentage) state.contextUsagePercentage = 0;

        // Handle assistantResponseEvent
        if (eventType === "assistantResponseEvent" && event.payload?.content) {
          const content = event.payload.content;
          state.totalContentLength += content.length;

          const chunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: chunkIndex === 0 ? { role: "assistant", content } : { content },
                finish_reason: null,
              },
            ],
          };
          chunkIndex++;
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }

        // Handle codeEvent
        if (eventType === "codeEvent" && event.payload?.content) {
          const chunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content: event.payload.content },
                finish_reason: null,
              },
            ],
          };
          chunkIndex++;
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }

        // Handle toolUseEvent
        if (eventType === "toolUseEvent" && event.payload) {
          state.hasToolCalls = true;
          const toolUse = event.payload;
          const toolUses = Array.isArray(toolUse) ? toolUse : [toolUse];

          for (const singleToolUse of toolUses) {
            const toolCallId = singleToolUse.toolUseId || `call_${Date.now()}`;
            const toolName = singleToolUse.name || "";
            const toolInput = singleToolUse.input;

            let toolIndex;
            const isNewTool = !state.seenToolIds.has(toolCallId);

            if (isNewTool) {
              toolIndex = state.toolCallIndex++;
              state.seenToolIds.set(toolCallId, toolIndex);

              const startChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      ...(chunkIndex === 0 ? { role: "assistant" } : {}),
                      tool_calls: [
                        {
                          index: toolIndex,
                          id: toolCallId,
                          type: "function",
                          function: {
                            name: toolName,
                            arguments: "",
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
              chunkIndex++;
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(startChunk)}\n\n`),
              );
            } else {
              toolIndex = state.seenToolIds.get(toolCallId);
            }

            if (toolInput !== undefined) {
              let argumentsStr;

              if (typeof toolInput === "string") {
                argumentsStr = toolInput;
              } else if (typeof toolInput === "object") {
                argumentsStr = JSON.stringify(toolInput);
              } else {
                continue;
              }

              const argsChunk = {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: toolIndex,
                          function: {
                            arguments: argumentsStr,
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
              chunkIndex++;
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(argsChunk)}\n\n`),
              );
            }
          }
        }

        // Handle messageStopEvent
        if (eventType === "messageStopEvent") {
          state.messageStopEvent = true;
          if (!state.finishEmitted) {
            const chunk = {
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: state.hasToolCalls ? "tool_calls" : "stop",
                },
              ],
            };
            state.finishEmitted = true;
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        }

        // Handle contextUsageEvent to extract contextUsagePercentage
        if (eventType === "contextUsageEvent" && event.payload?.contextUsagePercentage) {
          state.contextUsagePercentage = event.payload.contextUsagePercentage;
          // Mark that we received context usage event
          state.hasContextUsage = true;
        }

        // Handle meteringEvent - mark that we received it
        if (eventType === "meteringEvent") {
          state.hasMeteringEvent = true;
        }

        // Handle metricsEvent for token usage
        if (eventType === "metricsEvent") {
          // Extract usage data from metricsEvent payload
          const metrics = event.payload?.metricsEvent || event.payload;
          if (metrics && typeof metrics === "object") {
            const inputTokens = metrics.inputTokens || 0;
            const outputTokens = metrics.outputTokens || 0;

            if (inputTokens > 0 || outputTokens > 0) {
              state.usage = {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
              };
            }
          }
        }

        // Emit final chunk after messageStopEvent or after receiving BOTH meteringEvent AND contextUsageEvent
        if (
          (state.messageStopEvent || (state.hasMeteringEvent && state.hasContextUsage)) &&
          !state.finishEmitted
        ) {
          state.finishEmitted = true;

          // Estimate tokens if not available from events
          if (!state.usage) {
            // Estimate output tokens from content length
            const estimatedOutputTokens =
              state.totalContentLength > 0
                ? Math.max(1, Math.floor(state.totalContentLength / 4))
                : 0;

            // Estimate input tokens from contextUsagePercentage
            // Kiro models typically have 200k context window
            const estimatedInputTokens =
              state.contextUsagePercentage > 0
                ? Math.floor((state.contextUsagePercentage * 200000) / 100)
                : 0;

            state.usage = {
              prompt_tokens: estimatedInputTokens,
              completion_tokens: estimatedOutputTokens,
              total_tokens: estimatedInputTokens + estimatedOutputTokens,
            };
          }

          const finishChunk: any = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: state.hasToolCalls ? "tool_calls" : "stop",
              },
            ],
          };

          // Include usage in final chunk if available
          if (state.usage) {
            finishChunk.usage = state.usage;
          }

          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
        }
      }

      if (iterations >= maxIterations) {
        console.warn("[Kiro] Max iterations reached in event parsing");
      }
    };

    const transformStream = new TransformStream({
      start(controller: any) {
        upstreamReader = response.body.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await upstreamReader.read();
              if (done) break;
              await processChunk(value, controller);
            }
          } catch (err: any) {
            if (err.name !== "AbortError") {
              controller.error(err);
            }
          }
        })();
      },

      transform() {
        // No-op - reading and parsing handled in start()
      },

      flush(controller: any) {
        // Emit finish chunk if not already sent
        if (!state.finishEmitted) {
          state.finishEmitted = true;
          const finishChunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: state.hasToolCalls ? "tool_calls" : "stop",
              },
            ],
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
        }

        // Send final done message
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      },

      cancel(reason: any) {
        try {
          if (upstreamReader && typeof upstreamReader.cancel === "function") {
            upstreamReader.cancel(reason);
          }
        } catch {
          // upstream reader already cancelled
        }
      },
    } as any);

    return new Response(transformStream.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  async refreshCredentials(credentials: any, log: any, proxyOptions: any = null) {
    if (!credentials.refreshToken) return null;

    try {
      // Use centralized refreshKiroToken function (handles both AWS SSO OIDC and Social Auth)
      const result = await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log,
        proxyOptions,
      );

      return result;
    } catch (error: any) {
      log?.error?.("TOKEN", `Kiro refresh error: ${error.message}`);
      return null;
    }
  }
}

/**
 * Parse AWS EventStream frame
 */
function parseEventFrame(data: any) {
  try {
    const view = new DataView(data.buffer, data.byteOffset);
    const headersLength = view.getUint32(4, false);

    // Parse headers
    const headers: Record<string, any> = {};
    let offset = 12; // After prelude
    const headerEnd = 12 + headersLength;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset];
      offset++;
      if (offset + nameLen > data.length) break;

      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) {
        // String type
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;

        const value = new TextDecoder().decode(data.slice(offset, offset + valueLen));
        offset += valueLen;
        headers[name] = value;
      } else {
        break;
      }
    }

    // Parse payload
    const payloadStart = 12 + headersLength;
    const payloadEnd = data.length - 4; // Exclude message CRC

    let payload = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = new TextDecoder().decode(data.slice(payloadStart, payloadEnd));

      // Skip empty or whitespace-only payloads
      if (!payloadStr || !payloadStr.trim()) {
        return { headers, payload: null };
      }

      try {
        payload = JSON.parse(payloadStr);
      } catch (parseError: any) {
        // Log parse error for debugging
        console.warn(
          `[Kiro] Failed to parse payload: ${parseError.message} | payload: ${payloadStr.substring(0, 100)}`,
        );
        payload = { raw: payloadStr };
      }
    }

    return { headers, payload };
  } catch {
    return null;
  }
}

export default KiroExecutor;
