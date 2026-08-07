import zlib from "node:zlib";
import type { IncomingHttpHeaders } from "node:http2";
import { PROVIDERS } from "../config/providers.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { FORMATS } from "../translator/formats.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { extractTextFromResponse, generateCursorBody } from "../utils/cursorProtobuf.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { estimateUsage } from "../utils/usageTracking.js";
import {
  BaseExecutor,
  type ExecutorCredentials,
  type ExecutorExecuteOptions,
  type ExecutorHeaders,
  type ExecutorProxyOptions,
} from "./base.js";

type EdgeRuntimeGlobal = typeof globalThis & { EdgeRuntime?: unknown };
type Http2Module = typeof import("node:http2");
type CursorCredentials = ExecutorCredentials & {
  providerSpecificData?: ExecutorCredentials["providerSpecificData"] & {
    ghostMode?: boolean;
    machineId?: string;
  };
  rawHeaders?: Record<string, string>;
};
type CursorProxyOptions = Record<string, unknown> & {
  connectionProxyEnabled?: boolean;
  enabled?: boolean;
  vercelRelayUrl?: unknown;
};
type CursorRequestBody = {
  messages?: Array<Record<string, unknown>>;
  reasoning_effort?: string | null;
  tools?: Array<Record<string, unknown>>;
};
type CursorTransportResponse = {
  body: Buffer;
  headers: Record<string, unknown>;
  status: number;
};
type CursorErrorPayload = {
  error?: {
    code?: unknown;
    details?: Array<{ debug?: { details?: { detail?: string; title?: string }; error?: string } }>;
    message?: string;
  };
};
type CursorToolCall = {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
  index?: number;
  isLast?: boolean;
  type: string;
};
type CursorAssistantMessage = {
  content: string | null;
  role: "assistant";
  tool_calls?: Array<{
    function: {
      arguments: string;
      name: string;
    };
    id: string;
    type: string;
  }>;
};

// Detect cloud environment
const isCloudEnv = () => {
  if (typeof caches !== "undefined" && typeof caches === "object") return true;
  if (typeof (globalThis as EdgeRuntimeGlobal).EdgeRuntime !== "undefined") return true;
  return false;
};

// Lazy import http2 (only in Node.js environment)
let http2: Http2Module | null = null;
if (!isCloudEnv()) {
  try {
    http2 = await import("node:http2");
  } catch {
    // Optional Node-only transport; fetch remains the fallback.
  }
}

const COMPRESS_FLAG = {
  NONE: 0x00,
  GZIP: 0x01,
  TRAILER: 0x02,
  GZIP_TRAILER: 0x03,
};

const CURSOR_STREAM_DEBUG = process.env.CURSOR_STREAM_DEBUG === "1";
const debugLog = (...args: unknown[]) => {
  if (CURSOR_STREAM_DEBUG) console.log(...args);
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function decompressPayload(payload: Buffer, flags: number) {
  // Check if payload is JSON error (starts with {"error")
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    try {
      const text = payload.toString("utf-8");
      if (text.startsWith('{"error"')) {
        debugLog(`[DECOMPRESS] Detected JSON error, skipping decompression`);
        return payload;
      }
    } catch {
      // Payload sniffing only; decompression below handles binary frames.
    }
  }

  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    // Primary: try gzip decompression (standard gzip header 0x1f 0x8b)
    try {
      return zlib.gunzipSync(payload);
    } catch (gzipErr: unknown) {
      // Fallback: TRAILER and GZIP_TRAILER frames sometimes use raw zlib deflate format
      try {
        return zlib.inflateSync(payload);
      } catch (deflateErr: unknown) {
        // Last resort: try raw deflate (no zlib header)
        try {
          return zlib.inflateRawSync(payload);
        } catch (rawErr: unknown) {
          debugLog(
            `[DECOMPRESS ERROR] flags=${flags}, payloadSize=${payload.length}, gzip=${errorMessage(gzipErr)}, deflate=${errorMessage(deflateErr)}, raw=${errorMessage(rawErr)}`,
          );
          debugLog(
            `[DECOMPRESS ERROR] First 50 bytes (hex):`,
            payload.slice(0, 50).toString("hex"),
          );
          return payload;
        }
      }
    }
  }
  return payload;
}

function createErrorResponse(jsonError: CursorErrorPayload) {
  const errorMsg =
    jsonError?.error?.details?.[0]?.debug?.details?.title ||
    jsonError?.error?.details?.[0]?.debug?.details?.detail ||
    jsonError?.error?.message ||
    "API Error";

  const isRateLimit = jsonError?.error?.code === "resource_exhausted";

  return new Response(
    JSON.stringify({
      error: {
        message: errorMsg,
        type: isRateLimit ? "rate_limit_error" : "api_error",
        code: jsonError?.error?.details?.[0]?.debug?.error || "unknown",
      },
    }),
    {
      status: isRateLimit ? HTTP_STATUS.RATE_LIMITED : HTTP_STATUS.BAD_REQUEST,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export class CursorExecutor extends BaseExecutor {
  constructor() {
    super("cursor", PROVIDERS.cursor);
  }

  buildUrl() {
    return `${this.config.baseUrl}${this.config.chatPath}`;
  }

  buildHeaders(credentials: CursorCredentials): ExecutorHeaders {
    const accessToken = credentials.accessToken;
    const machineId = credentials.providerSpecificData?.machineId;
    const ghostMode = credentials.providerSpecificData?.ghostMode !== false;

    if (!machineId) {
      throw new Error("Machine ID is required for Cursor API");
    }

    return buildCursorHeaders(accessToken, machineId, ghostMode);
  }

  transformRequest(
    model: string,
    body: CursorRequestBody,
    _stream: boolean,
    credentials: CursorCredentials,
  ) {
    // Messages are already translated by chatCore (claude→openai→cursor)
    // Do NOT call buildCursorRequest again — double-translation drops tool_results
    const messages = body.messages || [];
    const tools = body.tools || [];
    const reasoningEffort = body.reasoning_effort || null;
    // Detect Claude Code UA to force Agent mode (issue #643)
    const ua = credentials?.rawHeaders?.["user-agent"] || "";
    const forceAgentMode =
      ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code");
    return generateCursorBody(messages, model, tools, reasoningEffort, forceAgentMode);
  }

  async makeFetchRequest(
    url: string,
    headers: ExecutorHeaders,
    body: BodyInit,
    signal: AbortSignal | undefined,
    proxyOptions: ExecutorProxyOptions = null,
  ): Promise<CursorTransportResponse> {
    const response = await proxyAwareFetch(
      url,
      {
        method: "POST",
        headers,
        body,
        signal,
      },
      proxyOptions,
    );

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer()),
    };
  }

  makeHttp2Request(
    url: string,
    headers: ExecutorHeaders,
    body: Uint8Array,
    signal: AbortSignal | undefined,
  ): Promise<CursorTransportResponse> {
    if (!http2) {
      throw new Error("http2 module not available");
    }

    const HTTP2_TIMEOUT_MS = 60000; // 60s max — prevent hung sessions

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = http2.connect(`https://${urlObj.host}`);
      const chunks: Buffer[] = [];
      let responseHeaders: IncomingHttpHeaders & { ":status"?: number } = {};
      let settled = false;

      // Ensure client is always closed on settle
      const finish =
        <Args extends unknown[]>(fn: (...args: Args) => void) =>
        (...args: Args) => {
          if (settled) return;
          settled = true;
          clearTimeout(hangTimeout);
          client.close();
          fn(...args);
        };

      // Hard timeout: close session if server never responds
      const hangTimeout = setTimeout(
        finish(() => {
          reject(new Error("HTTP/2 request timed out"));
        }),
        HTTP2_TIMEOUT_MS,
      );

      client.on("error", finish(reject));

      const req = client.request({
        ":method": "POST",
        ":path": urlObj.pathname,
        ":authority": urlObj.host,
        ":scheme": "https",
        ...headers,
      });

      req.on("response", (hdrs: IncomingHttpHeaders & { ":status"?: number }) => {
        responseHeaders = hdrs;
      });
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on(
        "end",
        finish(() => {
          resolve({
            status: responseHeaders[":status"],
            headers: responseHeaders,
            body: Buffer.concat(chunks),
          });
        }),
      );
      req.on("error", finish(reject));

      if (signal) {
        const onAbort = finish(() => reject(new Error("Request aborted")));
        signal.addEventListener("abort", onAbort, { once: true });
      }

      req.write(body);
      req.end();
    });
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log: _log,
    proxyOptions = null,
  }: ExecutorExecuteOptions) {
    const url = this.buildUrl();
    const cursorCredentials = credentials as CursorCredentials;
    const cursorBody = (body && typeof body === "object" ? body : {}) as CursorRequestBody;
    const headers = this.buildHeaders(cursorCredentials);
    const transformedBody = this.transformRequest(model, cursorBody, stream, cursorCredentials);

    try {
      const cursorProxyOptions = proxyOptions as CursorProxyOptions | null;
      const shouldForceFetch =
        cursorProxyOptions?.enabled === true ||
        cursorProxyOptions?.connectionProxyEnabled === true ||
        !!cursorProxyOptions?.vercelRelayUrl;
      const response =
        http2 && !shouldForceFetch
          ? await this.makeHttp2Request(url, headers, transformedBody, signal)
          : await this.makeFetchRequest(url, headers, transformedBody, signal, proxyOptions);

      if (response.status !== 200) {
        const errorText = response.body?.toString() || "Unknown error";
        const errorResponse = new Response(
          JSON.stringify({
            error: {
              message: `[${response.status}]: ${errorText}`,
              type: "invalid_request_error",
              code: "",
            },
          }),
          {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          },
        );
        return { response: errorResponse, url, headers, transformedBody: body };
      }

      const transformedResponse =
        stream !== false
          ? this.transformProtobufToSSE(response.body, model, body)
          : this.transformProtobufToJSON(response.body, model, body);

      return { response: transformedResponse, url, headers, transformedBody: body };
    } catch (error: unknown) {
      const errorResponse = new Response(
        JSON.stringify({
          error: {
            message: errorMessage(error),
            type: "connection_error",
            code: "",
          },
        }),
        {
          status: HTTP_STATUS.SERVER_ERROR,
          headers: { "Content-Type": "application/json" },
        },
      );
      return { response: errorResponse, url, headers, transformedBody: body };
    }
  }

  transformProtobufToJSON(buffer: Buffer, model: string, body: unknown) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let offset = 0;
    let totalContent = "";
    const toolCalls: CursorToolCall[] = [];
    const toolCallsMap = new Map<string, CursorToolCall>(); // Track streaming tool calls by ID
    const finalizedIds = new Set<string>();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) {
        debugLog(
          `[CURSOR BUFFER] Reached end, offset=${offset}, remaining=${buffer.length - offset}`,
        );
        break;
      }

      const flags = buffer[offset];
      const length = buffer.readUInt32BE(offset + 1);

      debugLog(
        `[CURSOR BUFFER] Frame ${frameCount + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`,
      );

      if (offset + 5 + length > buffer.length) {
        debugLog(
          `[CURSOR BUFFER] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`,
        );
        break;
      }

      let payload = buffer.slice(offset + 5, offset + 5 + length);
      offset += 5 + length;
      frameCount++;

      payload = decompressPayload(payload, flags);
      if (!payload) {
        debugLog(`[CURSOR BUFFER] Frame ${frameCount}: decompression failed, skipping`);
        continue;
      }

      // Check for JSON error frames (byte guard: skip toString on non-JSON frames)
      if (payload.length > 0 && payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`,
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {
          // Non-JSON Cursor frames are decoded as protobuf below.
        }
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited",
            },
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          if (existing) {
            existing.function.arguments += tc.function.arguments;
            existing.isLast = tc.isLast;
          }
        } else {
          // New tool call
          toolCallsMap.set(tc.id, { ...tc });
        }

        // Push to final array when isLast is true
        if (tc.isLast) {
          const finalToolCall = toolCallsMap.get(tc.id);
          finalizedIds.add(tc.id);
          if (finalToolCall) {
            toolCalls.push({
              id: finalToolCall.id,
              type: finalToolCall.type,
              function: {
                name: finalToolCall.function.name,
                arguments: finalToolCall.function.arguments,
              },
            });
          }
        }
      }

      if (result.text) totalContent += result.text;
    }

    debugLog(
      `[CURSOR BUFFER] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, finalized toolCalls: ${toolCalls.length}`,
    );

    // Finalize all remaining tool calls in map (in case stream ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      // Check if already in final array
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        });
      }
    }

    debugLog(`[CURSOR BUFFER] Final toolCalls count: ${toolCalls.length}`);

    const message: CursorAssistantMessage = {
      role: "assistant",
      content: totalContent || null,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI);

    const completion = {
      id: responseId,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        },
      ],
      usage,
    };

    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  transformProtobufToSSE(buffer: Buffer, model: string, body: unknown) {
    const responseId = `chatcmpl-cursor-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    const chunks: string[] = [];
    let offset = 0;
    let totalContent = "";
    const toolCalls: CursorToolCall[] = [];
    const toolCallsMap = new Map<string, CursorToolCall>(); // Track streaming tool calls by ID
    const finalizedIds = new Set<string>();
    const emittedToolCallIds = new Set<string>();
    let frameCount = 0;

    debugLog(`[CURSOR BUFFER SSE] Total length: ${buffer.length} bytes`);

    while (offset < buffer.length) {
      if (offset + 5 > buffer.length) {
        debugLog(
          `[CURSOR BUFFER SSE] Reached end, offset=${offset}, remaining=${buffer.length - offset}`,
        );
        break;
      }

      const flags = buffer[offset];
      const length = buffer.readUInt32BE(offset + 1);

      debugLog(
        `[CURSOR BUFFER SSE] Frame ${frameCount + 1}: flags=0x${flags.toString(16).padStart(2, "0")}, length=${length}`,
      );

      if (offset + 5 + length > buffer.length) {
        debugLog(
          `[CURSOR BUFFER SSE] Incomplete frame, offset=${offset}, length=${length}, buffer.length=${buffer.length}`,
        );
        break;
      }

      let payload = buffer.slice(offset + 5, offset + 5 + length);
      offset += 5 + length;
      frameCount++;

      payload = decompressPayload(payload, flags);
      if (!payload) {
        debugLog(`[CURSOR BUFFER SSE] Frame ${frameCount}: decompression failed, skipping`);
        continue;
      }

      // Check for JSON error frames (byte-guard: only decode if starts with '{')
      if (payload[0] === 0x7b) {
        try {
          const text = payload.toString("utf-8");
          if (text.includes('"error"')) {
            const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
            debugLog(
              `[CURSOR BUFFER SSE] Error frame (hasContent=${hasContent}): ${text.slice(0, 500)}`,
            );
            if (hasContent) {
              break;
            }
            return createErrorResponse(JSON.parse(text));
          }
        } catch {
          // Non-JSON Cursor frames are decoded as protobuf below.
        }
      }

      const result = extractTextFromResponse(new Uint8Array(payload));
      debugLog(`[CURSOR DECODED SSE] Frame ${frameCount}:`, result);

      if (result.error) {
        const hasContent = chunks.length > 0 || totalContent || toolCallsMap.size > 0;
        debugLog(`[CURSOR BUFFER SSE] Decoded error (hasContent=${hasContent}): ${result.error}`);
        if (hasContent) {
          break;
        }
        return new Response(
          JSON.stringify({
            error: {
              message: result.error,
              type: "rate_limit_error",
              code: "rate_limited",
            },
          }),
          {
            status: HTTP_STATUS.RATE_LIMITED,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (result.toolCall) {
        const tc = result.toolCall;

        if (chunks.length === 0) {
          chunks.push(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "" },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
        }

        if (toolCallsMap.has(tc.id)) {
          // Accumulate arguments for existing tool call
          const existing = toolCallsMap.get(tc.id);
          if (!existing) continue;
          const _oldArgsLen = existing.function.arguments.length;
          existing.function.arguments += tc.function.arguments;
          existing.isLast = tc.isLast;

          // Stream the delta arguments
          if (tc.function.arguments) {
            emittedToolCallIds.add(tc.id);
            chunks.push(
              `data: ${JSON.stringify({
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
                          index: existing.index,
                          id: tc.id,
                          type: "function",
                          function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            );
          }
        } else {
          // New tool call - assign index and add to map
          const toolCallIndex = toolCalls.length;
          finalizedIds.add(tc.id);
          toolCalls.push({ ...tc, index: toolCallIndex });
          toolCallsMap.set(tc.id, { ...tc, index: toolCallIndex });

          // Stream initial tool call with name
          emittedToolCallIds.add(tc.id);
          chunks.push(
            `data: ${JSON.stringify({
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
                        index: toolCallIndex,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
        }
      }

      if (result.text) {
        totalContent += result.text;
        chunks.push(
          `data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta:
                  chunks.length === 0 && toolCalls.length === 0
                    ? { role: "assistant", content: result.text }
                    : { content: result.text },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
      }
    }

    debugLog(
      `[CURSOR BUFFER SSE] Parsed ${frameCount} frames, toolCallsMap size: ${toolCallsMap.size}, toolCalls array: ${toolCalls.length}`,
    );

    // Finalize all remaining tool calls in map (stream may have ended without isLast=true)
    for (const [id, tc] of toolCallsMap.entries()) {
      if (!finalizedIds.has(id)) {
        debugLog(`[CURSOR BUFFER SSE] Finalizing incomplete tool call: ${id}, isLast=${tc.isLast}`);
        const toolCallIndex = toolCalls.length;
        toolCalls.push({
          id: tc.id,
          type: tc.type,
          index: toolCallIndex,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        });

        // Emit SSE chunk for the finalized tool call if not already emitted
        if (!emittedToolCallIds.has(tc.id)) {
          chunks.push(
            `data: ${JSON.stringify({
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
                        index: toolCallIndex,
                        id: tc.id,
                        type: "function",
                        function: {
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
        }
      }
    }

    if (chunks.length === 0 && toolCalls.length === 0) {
      chunks.push(
        `data: ${JSON.stringify({
          id: responseId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
    }

    const usage = estimateUsage(body, totalContent.length, FORMATS.OPENAI);

    chunks.push(
      `data: ${JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
          },
        ],
        usage,
      })}\n\n`,
    );
    chunks.push("data: [DONE]\n\n");

    return new Response(chunks.join(""), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  async refreshCredentials() {
    return null;
  }
}

export default CursorExecutor;
