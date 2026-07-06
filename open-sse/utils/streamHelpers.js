import { FORMATS } from "../translator/formats.js";

// Parse SSE data line
export function parseSSELine(line, format = null) {
  if (!line) return null;

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
  } catch (_error) {
    if (data.length > 0 && data.length < 1000) {
      console.log(
        `[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`,
      );
    }
    return null;
  }
}

// Check if chunk has valuable content (not empty)
export function hasValuableContent(chunk, format) {
  // OpenAI format
  if (format === FORMATS.OPENAI) {
    // Keep chunks that carry top-level reasoning summary envelopes, even when
    // `choices` is empty (Inception-style final summary chunk).
    if (
      chunk &&
      typeof chunk === "object" &&
      Object.prototype.hasOwnProperty.call(chunk, "reasoning_summary")
    ) {
      return true;
    }
    if (!chunk.choices?.[0]?.delta) return false;
    const delta = chunk.choices[0].delta;

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
      chunk.choices[0].finish_reason ||
      delta.role
    );
  }

  // Claude format
  if (format === FORMATS.CLAUDE) {
    const isContentBlockDelta = chunk.type === "content_block_delta";
    const hasText = chunk.delta?.text && chunk.delta.text !== "";
    const hasThinking = chunk.delta?.thinking && chunk.delta.thinking !== "";
    const hasInputJson = chunk.delta?.partial_json && chunk.delta.partial_json !== "";

    if (hasText) {
      const trimmed = chunk.delta.text.trim();
      if (trimmed === "..." || trimmed === "…") {
        return false;
      }
    }

    if (hasThinking) {
      const trimmed = chunk.delta.thinking.trim();
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
export function fixInvalidId(parsed) {
  if (parsed.id && (parsed.id === "chat" || parsed.id === "completion" || parsed.id.length < 8)) {
    const fallbackId =
      parsed.extend_fields?.requestId || parsed.extend_fields?.traceId || Date.now().toString(36);
    parsed.id = `chatcmpl-${fallbackId}`;
    return true;
  }
  return false;
}

function cleanUsagePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  let cleaned = payload;

  if ("usage" in cleaned) {
    if (cleaned.usage === null) {
      const { usage, ...payloadWithoutUsage } = cleaned;
      cleaned = payloadWithoutUsage;
    } else if (typeof cleaned.usage === "object" && cleaned.usage.perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = cleaned.usage;
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
export function formatSSE(data, sourceFormat) {
  if (data === null || data === undefined) return "data: null\n\n";
  if (data && data.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format
  if (data && data.event && data.data) {
    const cleanedEventData = cleanUsagePayload(data.data);
    return `event: ${data.event}\ndata: ${JSON.stringify(cleanedEventData)}\n\n`;
  }

  data = cleanUsagePayload(data);

  // Claude format
  if (sourceFormat === FORMATS.CLAUDE && data && data.type) {
    return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}
