import { saveRequestDetail } from "@/lib/usageDb";
import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";

type JsonRecord = Record<string, unknown>;

type StreamContent = { content?: string; thinking?: string | null };

type RequestLoggerLike = {
  appendConvertedChunk?: (chunk: string) => void;
  appendOpenAIChunk?: (chunk: string) => void;
  appendProviderChunk?: (chunk: string) => void;
};

type StreamCompleteHandler = (
  contentObj: StreamContent,
  usage: unknown,
  ttftAt: number | null,
) => void;

type BuildTransformStreamParams = {
  provider: string;
  sourceFormat: string;
  targetFormat: string;
  userAgent?: string;
  reqLogger?: RequestLoggerLike | null;
  toolNameMap?: unknown;
  model: string;
  connectionId?: string;
  body: JsonRecord;
  onStreamComplete?: StreamCompleteHandler | null;
  apiKey?: string | null;
};

type StreamingResponseParams = {
  providerResponse: Response;
  provider: string;
  model: string;
  sourceFormat: string;
  targetFormat: string;
  userAgent?: string;
  body: JsonRecord;
  stream: boolean;
  translatedBody?: unknown;
  finalBody?: unknown;
  requestStartTime: number;
  connectionId?: string;
  apiKey?: string | null;
  clientRawRequest?: { endpoint?: string } | null;
  onRequestSuccess?: () => Promise<void> | void;
  reqLogger?: RequestLoggerLike | null;
  toolNameMap?: unknown;
  streamController?: unknown;
  onStreamComplete?: StreamCompleteHandler | null;
};

type BuildOnStreamCompleteParams = {
  provider: string;
  model: string;
  connectionId?: string;
  apiKey?: string | null;
  requestStartTime: number;
  body: JsonRecord;
  stream: boolean;
  finalBody?: unknown;
  translatedBody?: unknown;
  clientRawRequest?: { endpoint?: string } | null;
};

type UsageTokensLike = {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({
  provider,
  sourceFormat,
  targetFormat,
  userAgent,
  reqLogger,
  toolNameMap,
  model,
  connectionId,
  body,
  onStreamComplete,
  apiKey,
}: BuildTransformStreamParams) {
  const isDroidCLI =
    userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  const needsCodexTranslation =
    provider === "codex" && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    // Codex returns Responses API SSE → translate to client format
    let codexTarget;
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) codexTarget = FORMATS.OPENAI_RESPONSES;
    else if (sourceFormat === FORMATS.CLAUDE) codexTarget = FORMATS.CLAUDE;
    else if (
      sourceFormat === FORMATS.ANTIGRAVITY ||
      sourceFormat === FORMATS.GEMINI ||
      sourceFormat === FORMATS.GEMINI_CLI
    )
      codexTarget = FORMATS.ANTIGRAVITY;
    else codexTarget = FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      codexTarget,
      provider,
      reqLogger,
      toolNameMap,
      model,
      connectionId,
      body,
      onStreamComplete,
      apiKey,
    );
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(
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
    );
  }

  return createPassthroughStreamWithLogger(
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    sourceFormat,
    toolNameMap,
  );
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export function handleStreamingResponse({
  providerResponse,
  provider,
  model,
  sourceFormat,
  targetFormat,
  userAgent,
  body,
  stream,
  translatedBody,
  finalBody,
  requestStartTime,
  connectionId,
  apiKey,
  clientRawRequest: _clientRawRequest,
  onRequestSuccess,
  reqLogger,
  toolNameMap,
  streamController,
  onStreamComplete,
}: StreamingResponseParams): { success: true; response: Response } {
  if (onRequestSuccess) onRequestSuccess();

  const transformStream = buildTransformStream({
    provider,
    sourceFormat,
    targetFormat,
    userAgent,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
  });
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController);

  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  saveRequestDetail(
    buildRequestDetail(
      {
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        providerResponse: "[Streaming - raw response not captured]",
        response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
        status: "success",
      },
      { id: streamDetailId },
    ),
  ).catch((err: unknown) => {
    console.error("[RequestDetail] Failed to save streaming request:", errorMessage(err));
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS }),
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({
  provider,
  model,
  connectionId,
  apiKey,
  requestStartTime,
  body,
  stream,
  finalBody,
  translatedBody,
  clientRawRequest,
}: BuildOnStreamCompleteParams) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete: StreamCompleteHandler = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime,
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(
      buildRequestDetail(
        {
          provider,
          model,
          connectionId,
          latency,
          tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
          request: extractRequestConfig(body, stream),
          providerRequest: finalBody || translatedBody || null,
          providerResponse: safeContent,
          response: { content: safeContent, thinking: safeThinking, type: "streaming" },
          status: "success",
        },
        { id: streamDetailId },
      ),
    ).catch((err: unknown) => {
      console.error("[RequestDetail] Failed to update streaming content:", errorMessage(err));
    });

    saveUsageStats({
      provider,
      model,
      tokens: (usage as UsageTokensLike | null | undefined) || null,
      connectionId,
      apiKey,
      endpoint: clientRawRequest?.endpoint,
      label: "STREAM USAGE",
    });
  };

  return { onStreamComplete, streamDetailId };
}
