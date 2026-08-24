// @ts-nocheck
import { v4 as uuidv4 } from "uuid";
import { isTransientErrorBody } from "../config/errorConfig.ts";
import { PROVIDERS } from "../config/providers.ts";
import { DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.ts";
import { refreshKiroToken } from "../services/tokenRefresh.ts";
import { proxyAwareFetch } from "../utils/proxyFetch.ts";
import {
  BaseExecutor,
  type ExecutorCredentials,
  type ExecutorExecuteOptions,
  type ExecutorHeaders,
  type ExecutorLogger,
  type ExecutorProxyOptions,
  type RetryEntry,
} from "./base.ts";

type JsonRecord = Record<string, unknown>;
type UsagePayload = {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
};
type KiroStreamState = {
  contextUsagePercentage: number;
  endDetected: boolean;
  finishEmitted: boolean;
  hasContextUsage: boolean;
  hasMeteringEvent: boolean;
  hasToolCalls: boolean;
  messageStopEvent: boolean;
  seenToolIds: Map<string, number>;
  toolCallIndex: number;
  totalContentLength: number;
  usage?: UsagePayload;
};
type EventFrame = {
  headers: Record<string, string>;
  payload: JsonRecord | JsonRecord[] | null;
};
type FinishChunk = {
  choices: Array<{
    delta: JsonRecord;
    finish_reason: string;
    index: number;
  }>;
  created: number;
  id: string;
  model: string;
  object: string;
  usage?: UsagePayload;
};
type KiroTransformer = Transformer<Uint8Array, Uint8Array> & {
  cancel(reason: unknown): void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * KiroExecutor - Executor for Kiro AI (AWS CodeWhisperer)
 * Uses AWS CodeWhisperer streaming API with AWS EventStream binary format
 */
export class KiroExecutor extends BaseExecutor {
  constructor() {
    super("kiro", PROVIDERS.kiro);
  }

  buildHeaders(credentials: ExecutorCredentials, _stream: boolean = true) {
    const headers: ExecutorHeaders = {
      ...this.config.headers,
      "Amz-Sdk-Request": "attempt=1; max=3",
      "Amz-Sdk-Invocation-Id": uuidv4(),
    };

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    return headers;
  }

  transformRequest(
    _model: string,
    body: unknown,
    _stream: boolean,
    _credentials: ExecutorCredentials,
  ) {
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
  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }: ExecutorExecuteOptions) {
    const url = this.buildUrl(model, stream, 0);
    const transformedBody = this.transformRequest(model, body, stream, credentials);

    // Merge default retry config with provider-specific config
    const retryConfig: Record<string, RetryEntry> = {
      ...DEFAULT_RETRY_CONFIG,
      ...this.config.retry,
    };
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
    const sleep = (ms: number, signal: AbortSignal | undefined) =>
      new Promise<void>((resolve, reject) => {
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
    const jitteredDelay = (baseMs: number, attempt: number) => {
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
      const { attempts: maxRetries, delayMs } = resolveRetryEntry(
        retryConfig[String(response.status)],
      );
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
  transformEventStreamToSSE(response: Response, model: string) {
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const state: KiroStreamState = {
      endDetected: false,
      finishEmitted: false,
      hasToolCalls: false,
      toolCallIndex: 0,
      seenToolIds: new Map<string, number>(),
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

    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    // Event parsing logic - called from start() for each chunk
    const processChunk = async (
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ) => {
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

        const payloadRecord = event.payload && !Array.isArray(event.payload) ? event.payload : null;

        // Handle assistantResponseEvent
        if (eventType === "assistantResponseEvent" && payloadRecord?.content) {
          const content = String(payloadRecord.content);
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
        if (eventType === "codeEvent" && payloadRecord?.content) {
          const content = String(payloadRecord.content);
          const chunk = {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: { content },
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
            const toolUseRecord = singleToolUse as JsonRecord;
            const toolCallId =
              typeof toolUseRecord.toolUseId === "string"
                ? toolUseRecord.toolUseId
                : `call_${Date.now()}`;
            const toolName = typeof toolUseRecord.name === "string" ? toolUseRecord.name : "";
            const toolInput = toolUseRecord.input;

            let toolIndex: number;
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
              toolIndex = state.seenToolIds.get(toolCallId) ?? state.toolCallIndex++;
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
        if (eventType === "contextUsageEvent" && payloadRecord?.contextUsagePercentage) {
          state.contextUsagePercentage = Number(payloadRecord.contextUsagePercentage);
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
          const metrics = payloadRecord?.metricsEvent || payloadRecord;
          if (metrics && typeof metrics === "object") {
            const metricsRecord = metrics as JsonRecord;
            const inputTokens = Number(metricsRecord.inputTokens || 0);
            const outputTokens = Number(metricsRecord.outputTokens || 0);

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

          const finishChunk: FinishChunk = {
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

    const responseBody = response.body;
    const transformer: KiroTransformer = {
      start(controller) {
        upstreamReader = responseBody.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await upstreamReader.read();
              if (done) break;
              await processChunk(value, controller);
            }
          } catch (err: unknown) {
            if (!isAbortError(err)) {
              controller.error(err);
            }
          }
        })();
      },

      transform() {
        // No-op - reading and parsing handled in start()
      },

      flush(controller) {
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

      cancel(reason) {
        try {
          if (upstreamReader && typeof upstreamReader.cancel === "function") {
            upstreamReader.cancel(reason);
          }
        } catch {
          // upstream reader already cancelled
        }
      },
    };

    const transformStream = new TransformStream<Uint8Array, Uint8Array>(transformer);

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

  async refreshCredentials(
    credentials: ExecutorCredentials,
    log: ExecutorLogger | null,
    proxyOptions: ExecutorProxyOptions = null,
  ) {
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
    } catch (error: unknown) {
      log?.error?.("TOKEN", `Kiro refresh error: ${errorMessage(error)}`);
      return null;
    }
  }
}

/**
 * Parse AWS EventStream frame
 */
function parseEventFrame(data: Uint8Array): EventFrame | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset);
    const headersLength = view.getUint32(4, false);

    // Parse headers
    const headers: Record<string, string> = {};
    let offset = 12; // After prelude
    const headerEnd = 12 + headersLength;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset] ?? 0;
      offset++;
      if (offset + nameLen > data.length) break;

      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) {
        // String type
        const valueLen = ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
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

    let payload: JsonRecord | JsonRecord[] | null = null;
    if (payloadEnd > payloadStart) {
      const payloadStr = new TextDecoder().decode(data.slice(payloadStart, payloadEnd));

      // Skip empty or whitespace-only payloads
      if (!payloadStr || !payloadStr.trim()) {
        return { headers, payload: null };
      }

      try {
        payload = JSON.parse(payloadStr) as JsonRecord | JsonRecord[];
      } catch (parseError: unknown) {
        // Log parse error for debugging
        console.warn(
          `[Kiro] Failed to parse payload: ${errorMessage(parseError)} | payload: ${payloadStr.substring(0, 100)}`,
        );
        payload = { raw: payloadStr };
      }
    }

    return { headers, payload };
  } catch {
    // Invalid EventStream frames are treated as absent payloads by caller.
    return null;
  }
}

export default KiroExecutor;
