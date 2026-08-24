import { randomUUID } from "node:crypto";
import { PROVIDERS } from "../config/providers.ts";
import { convertCommandCodeToOpenAI } from "../translator/response/commandcode-to-openai.ts";
import {
  BaseExecutor,
  type ExecutorConfigInput,
  type ExecutorCredentials,
  type ExecutorExecuteOptions,
  type ExecutorExecuteResult,
  type ExecutorHeaders,
} from "./base.ts";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE to JSON) downstream handlers in
 * pod can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", (PROVIDERS as Record<string, ExecutorConfigInput>).commandcode!);
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    const headers: ExecutorHeaders = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts: ExecutorExecuteOptions): Promise<ExecutorExecuteResult> {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;
    result.response = wrapNdjsonAsOpenAISse(result.response, opts.model);
    return result;
  }
}

function wrapNdjsonAsOpenAISse(originalResponse: Response, model: string): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model };

  const emitChunks = (
    chunks: unknown,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c === null || c === undefined) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Translate AI SDK v5 NDJSON line to one or more OpenAI chunks
        emitChunks(convertCommandCodeToOpenAI(trimmed, state), controller);
      }
    },
    flush(controller: TransformStreamDefaultController<Uint8Array>) {
      const trimmed = buffer.trim();
      if (trimmed) {
        emitChunks(convertCommandCodeToOpenAI(trimmed, state), controller);
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });

  const newBody = originalResponse.body!.pipeThrough(transform);
  return new Response(newBody, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}

export default CommandCodeExecutor;
