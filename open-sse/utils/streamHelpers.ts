import { FORMATS } from "../translator/formats.ts";

type JsonRecord = Record<string, unknown>;

type OpenAIDelta = {
  content?: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
  role?: unknown;
};

type OpenAIChunk = JsonRecord & {
  choices?: Array<{
    delta?: OpenAIDelta;
    finish_reason?: unknown;
  }>;
  reasoning_summary?: unknown;
};

type ClaudeChunk = JsonRecord & {
  type?: string;
  delta?: {
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
};

type IdFixable = JsonRecord & {
  id?: string;
  extend_fields?: { requestId?: string; traceId?: string };
};

type UsagePayload = JsonRecord & {
  usage?: { perf_metrics?: unknown; [key: string]: unknown } | null;
  response?: unknown;
  done?: unknown;
  event?: unknown;
  data?: unknown;
  type?: unknown;
};

// Parse SSE data line
export function parseSSELine(line: unknown, format: unknown = null) {
  if (!line) return null;
  if (typeof line !== "string") return null;

  const trimmed = line.trim();

  // NDJSON format (Ollama): raw JSON lines without "data:" prefix
  if (format === FORMATS.OLLAMA || trimmed.startsWith("{")) {
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Standard SSE format: "data: {...}"
  if (line.charCodeAt(0) !== 100) return null; // 'd' = 100

  const data = line.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    return JSON.parse(data);
  } catch {
    if (data.length > 0 && data.length < 1000) {
      console.log(
        `[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`,
      );
    }
    return null;
  }
}

// Check if chunk has valuable content (not empty)
export function hasValuableContent(chunk: unknown, format: unknown) {
  // OpenAI format
  if (format === FORMATS.OPENAI) {
    const openaiChunk = chunk as OpenAIChunk | null;
    // Keep chunks that carry top-level reasoning summary envelopes, even when
    // `choices` is empty (Inception-style final summary chunk).
    if (
      openaiChunk &&
      typeof openaiChunk === "object" &&
      Object.prototype.hasOwnProperty.call(openaiChunk, "reasoning_summary")
    ) {
      return true;
    }
    if (!openaiChunk?.choices?.[0]?.delta) return false;
    const delta = openaiChunk.choices[0].delta;

    if (delta.content && delta.content !== "") {
      const trimmed = delta.content.trim();
      if (trimmed === "..." || trimmed === "…") {
        return false;
      }
    }

    if (delta.reasoning_content && delta.reasoning_content !== "") {
      const trimmed = delta.reasoning_content.trim();
      if (trimmed === "..." || trimmed === "…") {
        return false;
      }
    }

    return (
      (delta.content && delta.content !== "") ||
      (delta.reasoning_content && delta.reasoning_content !== "") ||
      (delta.tool_calls && delta.tool_calls.length > 0) ||
      openaiChunk.choices[0].finish_reason ||
      delta.role
    );
  }

  // Claude format
  if (format === FORMATS.CLAUDE) {
    const claudeChunk = chunk as ClaudeChunk;
    const isContentBlockDelta = claudeChunk.type === "content_block_delta";
    const hasText = Boolean(claudeChunk.delta?.text && claudeChunk.delta.text !== "");
    const hasThinking = Boolean(claudeChunk.delta?.thinking && claudeChunk.delta.thinking !== "");
    const hasInputJson = Boolean(
      claudeChunk.delta?.partial_json && claudeChunk.delta.partial_json !== "",
    );

    if (hasText) {
      const trimmed = claudeChunk.delta!.text!.trim();
      if (trimmed === "..." || trimmed === "…") {
        return false;
      }
    }

    if (hasThinking) {
      const trimmed = claudeChunk.delta!.thinking!.trim();
      if (trimmed === "..." || trimmed === "…") {
        return false;
      }
    }

    if (isContentBlockDelta && !hasText && !hasThinking && !hasInputJson) {
      return false;
    }
    return true;
  }

  return true; // Other formats: keep all chunks
}

// Fix invalid id (generic or too short)
export function fixInvalidId(parsed: IdFixable) {
  if (parsed.id && (parsed.id === "chat" || parsed.id === "completion" || parsed.id.length < 8)) {
    const fallbackId =
      parsed.extend_fields?.requestId || parsed.extend_fields?.traceId || Date.now().toString(36);
    parsed.id = `chatcmpl-${fallbackId}`;
    return true;
  }
  return false;
}

function cleanUsagePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  let cleaned: UsagePayload = payload as UsagePayload;

  if ("usage" in cleaned) {
    if (cleaned.usage === null) {
      const { usage: _usage, ...payloadWithoutUsage } = cleaned;
      cleaned = payloadWithoutUsage;
    } else if (typeof cleaned.usage === "object" && cleaned.usage.perf_metrics === null) {
      const { perf_metrics: _perf_metrics, ...usageWithoutPerf } = cleaned.usage;
      cleaned = { ...cleaned, usage: usageWithoutPerf };
    }
  }

  if (
    cleaned.response &&
    typeof cleaned.response === "object" &&
    !Array.isArray(cleaned.response)
  ) {
    const cleanedResponse = cleanUsagePayload(cleaned.response);
    if (cleanedResponse !== cleaned.response) {
      cleaned = { ...cleaned, response: cleanedResponse };
    }
  }

  return cleaned;
}

// Format output as SSE
export function formatSSE(data: unknown, sourceFormat: unknown) {
  if (data === null || data === undefined) return "data: null\n\n";
  const record = data as UsagePayload | null;
  if (record && record.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format
  if (record && record.event && record.data) {
    const cleanedEventData = cleanUsagePayload(record.data);
    return `event: ${record.event}\ndata: ${JSON.stringify(cleanedEventData)}\n\n`;
  }

  data = cleanUsagePayload(data);
  const cleaned = data as UsagePayload | null;

  // Claude format
  if (sourceFormat === FORMATS.CLAUDE && cleaned && cleaned.type) {
    return `event: ${cleaned.type}\ndata: ${JSON.stringify(cleaned)}\n\n`;
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}
