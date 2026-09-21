import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";

type OllamaToolCall = {
  id?: unknown;
  index?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};
type OllamaContentBlock = {
  type?: unknown;
  text?: unknown;
  image_url?: { url?: unknown } | string;
};
type OllamaOpenAIBody = {
  messages?: unknown[];
  temperature?: unknown;
  max_tokens?: unknown;
  top_p?: unknown;
  tools?: unknown[];
  tool_choice?: unknown;
};

/**
 * Convert OpenAI request to Ollama format
 *
 * Ollama expects:
 * - model: string
 * - messages: Array<{role: string, content: string, images?: string[] }>
 * - stream: boolean
 * - options?: {temperature?: number, num_predict?: number}
 *
 * Key differences from OpenAI:
 * - Content must be string, not array
 * - Multimodal images should be mapped to `message.images[]` (raw base64, no data: prefix)
 * - tool role maps to tool (Ollama supports tool messages)
 */
export function openaiToOllamaRequest(model: unknown, body: unknown, stream: unknown) {
  const req = body as OllamaOpenAIBody; // trusted: registry passes OpenAI chat payloads
  const result: Record<string, unknown> & { options?: Record<string, unknown> } = {
    model: model,
    messages: normalizeMessages(req.messages),
    stream: stream,
  };

  // Temperature
  if (req.temperature !== undefined) {
    result.options = result.options || ({} as Record<string, unknown>);
    result.options.temperature = req.temperature;
  }

  // Max tokens (Ollama uses num_predict)
  if (req.max_tokens !== undefined) {
    result.options = result.options || ({} as Record<string, unknown>);
    result.options.num_predict = req.max_tokens;
  }

  // Top_p
  if (req.top_p !== undefined) {
    result.options = result.options || ({} as Record<string, unknown>);
    result.options.top_p = req.top_p;
  }

  // Tools (Ollama supports tools in OpenAI format)
  if (req.tools && Array.isArray(req.tools)) {
    result.tools = req.tools;
  }

  // Tool choice
  if (req.tool_choice) {
    result.tool_choice = req.tool_choice;
  }

  return result;
}

/**
 * Normalize messages to Ollama format
 * - Content must be string
 * - tool messages: convert tool_call_id to tool_name
 * - assistant messages: keep tool_calls as-is
 */
function normalizeMessages(messages: unknown) {
  if (!Array.isArray(messages)) return messages;

  const result: unknown[] = [];
  const toolCallMap = new Map<unknown, unknown>(); // Map tool_call_id -> tool_name

  // First pass: build tool_call_id -> tool_name map from assistant messages
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          toolCallMap.set(tc.id, tc.function.name);
        }
      }
    }
  }

  // Second pass: convert messages
  for (const msg of messages) {
    // Handle tool result messages (OpenAI format -> Ollama format)
    if (msg.role === "tool") {
      const toolResult = normalizeContent(msg.content);
      if (!toolResult) continue;

      // Get tool_name from map or use msg.name as fallback
      const toolName = toolCallMap.get(msg.tool_call_id) || msg.name || "unknown_tool";

      result.push({
        role: "tool",
        tool_name: toolName,
        content: toolResult,
      });
      continue;
    }

    // Handle assistant messages with tool_calls
    if (msg.role === "assistant" && msg.tool_calls) {
      const content = normalizeContent(msg.content) || "";

      // Convert OpenAI tool_calls format to Ollama format
      const ollamaToolCalls = msg.tool_calls.map((tc: OllamaToolCall) => ({
        type: "function",
        function: {
          index: tc.index || 0,
          name: tc.function?.name || "",
          arguments:
            typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments || "{}")
              : tc.function?.arguments || {},
        },
      }));

      result.push({
        role: "assistant",
        content: content,
        tool_calls: ollamaToolCalls,
      });
      continue;
    }

    // Normal messages
    const role = msg.role;
    const content = normalizeContent(msg.content);
    const images = extractImagesFromContent(msg.content);

    // Skip empty messages (except assistant)
    if (!content && role !== "assistant") continue;

    const out: Record<string, unknown> = {
      role: role,
      content: content,
    };

    if (images.length > 0) {
      out.images = images;
    }

    result.push(out);
  }

  return result;
}

/**
 * Normalize content to string
 * Ollama only accepts string content
 */
function normalizeContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Extract text from content array
    const textParts = content
      .filter((block: OllamaContentBlock) => block && block.type === "text" && block.text)
      .map((block: OllamaContentBlock) => block.text);

    return textParts.join("\n") || "";
  }

  return "";
}

/**
 * Extract base64 images from OpenAI multimodal content blocks.
 * OpenAI image block format:
 *   { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
 * Ollama expects raw base64 strings in message.images[].
 */
function extractImagesFromContent(content: unknown) {
  if (!Array.isArray(content)) return [];

  const images: unknown[] = [];

  for (const block of content) {
    if (!block || block.type !== "image_url") continue;

    const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
    if (typeof url !== "string" || !url) continue;

    const m = url.match(/^data:[^;]+;base64,([\s\S]+)$/);
    if (!m) continue;

    images.push(m[1]);
  }

  return images;
}

// Register translator
register(FORMATS.OPENAI, FORMATS.OLLAMA, openaiToOllamaRequest, null);
