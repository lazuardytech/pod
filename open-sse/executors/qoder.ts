/**
 * QoderExecutor — sends OpenAI-format chat requests to Qoder's COSY-signed
 * inference endpoint at api3.qoder.sh, then unwraps Qoder's `{statusCodeValue,
 * body}` SSE envelope back into plain OpenAI SSE for the rest of the pipeline.
 *
 * Differences vs the previous placeholder:
 *   - URL is api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation
 *     with `&Encode=1` so we can ship the body through the WAF-bypass
 *     encoder.
 *   - Authentication is COSY (RSA + AES + MD5 + ~17 Cosy-* headers), not
 *     a static HMAC.
 *   - The request shape Qoder expects is non-trivial (chat_context with
 *     mirrored modelConfig, business block with stable IDs, system text
 *     hoisted out of the messages array). All ported from the reference.
 *   - Model identifier is one of the canonical 11 keys (auto / ultimate /
 *     performance / efficient / lite + 6 frontier "*model" ids); the
 *     translator layer feeds us "qoder/<key>" so we strip the prefix.
 *   - Per-model `model_config` is fetched live from /algo/api/v2/model/list
 *     and cached. Sending the wrong block silently downgrades to a
 *     different model upstream, so a missing entry is a hard error.
 */

import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { QODER_CHAT_URL_ENCODED, QODER_MODEL_MAP } from "@/lib/qoder/constants";
import { buildCosyHeaders } from "@/lib/qoder/cosy";
import { qoderEncodeBody } from "@/lib/qoder/encoding";
import { PROVIDERS } from "../config/providers.js";
import {
  getQoderModelConfig,
  resolveQoderModels,
  type QoderCredentials,
} from "../services/qoderModels.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  BaseExecutor,
  type ExecutorExecuteOptions,
  type ExecutorExecuteResult,
  type ExecutorLogger,
  type ExecutorProxyOptions,
} from "./base.js";

type JsonRecord = Record<string, unknown>;

type ChatMessage = JsonRecord & {
  role?: string;
  content?: unknown;
};

type QoderEnvelope = {
  statusCodeValue?: number;
  body?: string;
};

type BuildQoderRequestArgs = {
  model: string;
  body: JsonRecord;
  credentials: QoderCredentials;
  log?: ExecutorLogger;
  proxyOptions?: ExecutorProxyOptions;
  signal?: AbortSignal;
};

/** TransformStream transformer that also cancels the upstream body. */
type QoderSseTransformer = Transformer<Uint8Array, Uint8Array> & {
  cancel(reason?: unknown): void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

/**
 * Hoist role:"system" messages out of the messages array (Qoder rejects
 * system in messages) and flatten any multipart content arrays.
 */
function normalizeMessages(messages: unknown): { messages: ChatMessage[]; systemText: string } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "" };
  }
  const systemParts: string[] = [];
  const out: ChatMessage[] = [];
  for (const msgUnknown of messages) {
    if (!msgUnknown || typeof msgUnknown !== "object") continue;
    const msg = msgUnknown as ChatMessage;
    const text = extractText(msg.content);
    if (msg.role === "system") {
      if (text) systemParts.push(text);
      continue;
    }
    const cloned: ChatMessage = { ...msg };
    cloned.content = text;
    out.push(cloned);
  }
  return { messages: out, systemText: systemParts.join("\n\n") };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object") {
        const rec = item as { type?: unknown; text?: unknown };
        if (rec.type === "text" && typeof rec.text === "string") {
          parts.push(rec.text);
        } else if (typeof rec.text === "string") {
          parts.push(rec.text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return "";
}

function stableHash(prefix: string, ...parts: unknown[]): string {
  const h = createHash("sha256");
  h.update(prefix);
  for (const p of parts) {
    h.update("\0");
    h.update(String(p ?? ""));
  }
  return h.digest("hex").slice(0, 16);
}

function stableChatRecordId(
  model: string,
  messages: ChatMessage[],
  tools: unknown,
  maxTokens: number,
): string {
  const h = createHash("sha256");
  h.update("qoder-record\0");
  h.update(String(model));
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role) {
      h.update("\0");
      h.update(m.role);
    }
    if (typeof m.content === "string" && m.content) {
      h.update("\0");
      h.update(m.content);
    }
  }
  if (tools) {
    h.update("\0");
    try {
      h.update(JSON.stringify(tools));
    } catch {
      // Tool hashing is best effort; maxTokens still participates in the key.
    }
  }
  h.update(`\0mt=${maxTokens}`);
  return h.digest("hex").slice(0, 16);
}

function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

/**
 * Map the OpenAI-style request body into the exact shape Qoder expects.
 */
async function buildQoderRequestBody({
  model,
  body,
  credentials,
  log,
  proxyOptions,
  signal,
}: BuildQoderRequestArgs) {
  const qoderKey = String(model || "").replace(/^qoder\//, "");
  if (!QODER_MODEL_MAP[qoderKey]) {
    throw new Error(`Unsupported qoder model: "${qoderKey}" (received "${model}")`);
  }

  let modelConfig = await getQoderModelConfig(credentials, qoderKey, { log, proxyOptions, signal });
  if (!modelConfig) {
    // Try a forced refresh once before giving up — the cache may simply
    // not be populated yet on first ever call for this credential.
    const refreshed = await resolveQoderModels(credentials, {
      forceRefresh: true,
      log,
      proxyOptions,
      signal,
    });
    const retried = refreshed?.rawConfigs.get(qoderKey);
    if (!retried) {
      throw new Error(
        `qoder: model_config for "${qoderKey}" not yet known (run a model list fetch or check upstream connectivity)`,
      );
    }
    modelConfig = { ...retried, key: qoderKey };
  }

  const { messages, systemText } = normalizeMessages(body.messages || []);
  const tools = body.tools;
  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

  let maxTokens = 32_768;
  if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  if (typeof body.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (
    typeof body.max_completion_tokens === "number" &&
    body.max_completion_tokens > 0 &&
    body.max_completion_tokens < maxTokens
  ) {
    maxTokens = body.max_completion_tokens;
  }

  const lastUser = lastUserText(messages);
  const psd = credentials.providerSpecificData || {};
  const sessionId = stableHash("qoder-session", psd.userId, qoderKey);
  const recordId = stableChatRecordId(qoderKey, messages, tools, maxTokens);

  return {
    qoderKey,
    payload: {
      request_id: uuidv4(),
      request_set_id: recordId,
      chat_record_id: recordId,
      session_id: sessionId,
      stream: true,
      chat_task: "FREE_INPUT",
      is_reply: true,
      is_retry: false,
      source: 1,
      version: "3",
      session_type: "qodercli",
      agent_id: "agent_common",
      task_id: "common",
      code_language: "",
      chat_prompt: "",
      image_urls: null,
      aliyun_user_type: "",
      system: systemText,
      messages,
      tools: Array.isArray(tools) ? tools : [],
      parameters: { max_tokens: maxTokens },
      chat_context: {
        chatPrompt: "",
        imageUrls: null,
        extra: {
          context: [],
          modelConfig: { key: qoderKey, is_reasoning: isReasoning },
          originalContent: lastUser,
        },
        features: [],
        text: lastUser,
      },
      model_config: modelConfig,
      business: {
        product: "cli",
        version: "1.0.0",
        type: "agent",
        stage: "start",
        id: uuidv4(),
        name: truncate(lastUser, 30),
        begin_at: Date.now(),
      },
    },
    modelConfig,
  };
}

/**
 * Wrap the upstream's `{statusCodeValue, body}` SSE envelope into plain
 * OpenAI SSE chunks the rest of the chatCore pipeline understands.
 *
 * Each upstream line looks like:
 *   data: {"statusCodeValue":200,"body":"{\"choices\":[{\"delta\":{...}}]}"}
 * The inner body is an OpenAI streaming chunk (or "[DONE]"). We unwrap it
 * and re-emit as `data: <inner>\n\n`. Errors become `data: [DONE]\n\n` plus
 * a synthetic OpenAI error chunk.
 */
function wrapQoderSSE(response: Response, model: string): Response {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let doneEmitted = false;

  // Process one already-extracted SSE line (no trailing newline). Returns
  // false when the line indicated end-of-stream so the caller can stop
  // forwarding any remaining chunks after [DONE].
  const processLine = (
    line: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("data:")) return;
    if (doneEmitted) return; // never forward chunks past stream end

    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      doneEmitted = true;
      return;
    }

    let envelope: QoderEnvelope;
    try {
      envelope = JSON.parse(data) as QoderEnvelope;
    } catch {
      // Malformed Qoder envelope lines are ignored; later frames may still be valid.
      return;
    }
    const statusVal = typeof envelope.statusCodeValue === "number" ? envelope.statusCodeValue : 200;
    const inner = typeof envelope.body === "string" ? envelope.body : "";
    if (statusVal !== 200) {
      const msg = inner || `upstream status ${statusVal}`;
      const errChunk = JSON.stringify({
        id: `qoder-error-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content: `\n[qoder error ${statusVal}: ${truncate(msg, 200)}]` },
            finish_reason: "stop",
          },
        ],
      });
      controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      doneEmitted = true;
      return;
    }
    if (!inner) return;
    if (inner === "[DONE]") {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      doneEmitted = true;
      return;
    }
    // Inner is an OpenAI-shaped chunk. Strip any embedded newlines so the
    // SSE frame stays a single event (a literal "\n" inside `inner` would
    // otherwise split the frame across multiple data: lines and downstream
    // parsers would reassemble them as separate events).
    const sanitized = inner.replace(/\r?\n/g, "");
    controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
  };

  const transformer: QoderSseTransformer = {
    async transform(chunk, controller) {
      try {
        buffer += decoder.decode(chunk, { stream: true });
        for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          try {
            processLine(line, controller);
          } catch (lineErr: unknown) {
            console.warn("[qoder] processLine error:", errorMessage(lineErr));
          }
        }
      } catch (err: unknown) {
        controller.error(err);
      }
    },
    cancel(reason) {
      try {
        if (typeof response.body?.cancel === "function") {
          response.body.cancel(reason);
        }
      } catch {
        // upstream body already cancelled
      }
    },
    flush(controller) {
      // Finalize the decoder so any pending multi-byte sequence is
      // released into `buffer` instead of being silently dropped.
      buffer += decoder.decode();
      // Drain any trailing line that arrived without a terminating newline
      // (e.g. upstream closed the socket immediately after the last write,
      // or a CDN stripped the final CRLF). Without this, the chunk that
      // carries finish_reason is silently lost.
      if (buffer.length > 0) {
        processLine(buffer, controller);
        buffer = "";
      }
      if (!doneEmitted) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        doneEmitted = true;
      }
    },
  };

  const transform = new TransformStream(transformer);

  const transformed = response.body.pipeThrough(transform);
  // Build a Response with passable headers; the streaming handler reads
  // `.body` as a ReadableStream regardless of Content-Type.
  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export class QoderExecutor extends BaseExecutor {
  constructor() {
    super("qoder", PROVIDERS.qoder);
  }

  buildUrl() {
    return QODER_CHAT_URL_ENCODED;
  }

  // Override execute entirely — Qoder needs:
  //   - body built from translated chat completion payload
  //   - body encoded with QoderEncodeBody before signing
  //   - COSY headers built from the *encoded* body bytes
  //   - response stream re-wrapped from {statusCodeValue, body} to OpenAI SSE
  async execute({
    model,
    body,
    stream: _stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }: ExecutorExecuteOptions): Promise<ExecutorExecuteResult> {
    const url = this.buildUrl();
    const qoderCredentials = credentials as QoderCredentials;

    const psd = qoderCredentials?.providerSpecificData || {};
    if (!psd.userId) {
      // No user id → no way to sign. Surface a 401 so the dashboard nudges
      // the user back to OAuth.
      const fakeResp = new Response(
        JSON.stringify({
          error: { message: "qoder credential is missing userId; reconnect the account" },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }
    if (!qoderCredentials?.accessToken) {
      // Same shape as the userId guard — clean 401 so chatCore reports
      // "reconnect" rather than bubbling cosy.js's synchronous throw as 500.
      const fakeResp = new Response(
        JSON.stringify({
          error: { message: "qoder credential is missing accessToken; reconnect the account" },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    let qoderKey: string;
    let payload: JsonRecord;
    try {
      ({ qoderKey, payload } = await buildQoderRequestBody({
        model,
        body: asRecord(body),
        credentials: qoderCredentials,
        log,
        proxyOptions,
        signal,
      }));
    } catch (err: unknown) {
      const fakeResp = new Response(JSON.stringify({ error: { message: errorMessage(err) } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const plainBody = Buffer.from(JSON.stringify(payload), "utf8");
    const encodedBodyStr = qoderEncodeBody(plainBody);
    const encodedBodyBuf = Buffer.from(encodedBodyStr, "latin1");

    let cosyHeaders: Record<string, string>;
    try {
      cosyHeaders = buildCosyHeaders(encodedBodyBuf, url, {
        userId: String(psd.userId),
        authToken: qoderCredentials.accessToken,
        name: qoderCredentials.displayName || "",
        email: qoderCredentials.email || "",
        machineId: typeof psd.machineId === "string" ? psd.machineId : "",
      });
    } catch (err: unknown) {
      // cosy.js throws synchronously on missing userId/authToken — surface
      // as 401 so chatCore prompts re-auth instead of returning a 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: `qoder cosy signing failed: ${errorMessage(err)}` } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const modelConfig = asRecord(payload.model_config);
    const modelSource = typeof modelConfig.source === "string" ? modelConfig.source : "system";
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Model-Key": qoderKey,
      "X-Model-Source": modelSource,
      // gzip triggers signature validation on Qoder's CDN; force identity.
      "Accept-Encoding": "identity",
      ...cosyHeaders,
    };

    const response = await proxyAwareFetch(
      url,
      { method: "POST", headers, body: encodedBodyBuf, signal },
      proxyOptions,
    );

    if (!response.ok) {
      // Pass error response through unchanged so chatCore can capture it.
      return { response, url, headers, transformedBody: payload };
    }

    const wrapped = wrapQoderSSE(response, `qoder/${qoderKey}`);
    return { response: wrapped, url, headers, transformedBody: payload };
  }

  // Qoder device tokens don't refresh through OAuth — the upstream returns
  // 403 for our flow. Surfacing failure via 401-on-chat is enough; the
  // dashboard tells users to re-login when their token expires (~30 days).
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default QoderExecutor;

// Internals exposed for unit tests. Not part of the public API — callers
// should import QoderExecutor and use its public methods.
export const __test__ = {
  normalizeMessages,
  wrapQoderSSE,
};
