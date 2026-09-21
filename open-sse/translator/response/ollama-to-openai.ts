import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";

interface OllamaToolCallFunction {
  name?: string;
  arguments?: string | Record<string, unknown>;
  index?: number;
}

interface OllamaToolCall {
  id?: string;
  function?: OllamaToolCallFunction;
}

interface OllamaMessage {
  content?: string;
  thinking?: string;
  tool_calls?: OllamaToolCall[];
}

/** Ollama NDJSON chunk (stream) or full response body (non-stream). */
interface OllamaChunk {
  model?: string;
  done?: boolean;
  done_reason?: string;
  message?: OllamaMessage;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaStreamState {
  id: string;
  created: number;
  model?: string;
  sentRole?: boolean;
}

interface OllamaTranslatorState {
  ollama?: OllamaStreamState | null;
  model?: string;
  hadToolCalls?: boolean;
  accumulatedContent?: string;
  accumulatedThinking?: string;
}

/**
 * Convert Ollama NDJSON response to OpenAI SSE format
 *
 * Ollama response format:
 * {"model": "...", "message": {"role": "assistant", "content": "..."}, "done": false}
 * {"model": "...", "done": true, "prompt_eval_count": 123, "eval_count": 456}
 *
 * OpenAI format:
 * {"id": "...", "object": "chat.completion.chunk", "created": 123, "model": "...",
 *  "choices": [{"index": 0, "delta": {"content": "..."}, "finish_reason": null}]}
 */
export function ollamaToOpenAI(chunk: unknown, state: unknown) {
  if (!chunk || typeof chunk !== "object") return null;

  const c = chunk as OllamaChunk;
  const s = state as OllamaTranslatorState;

  // Initialize state on first chunk
  if (!s.ollama) {
    s.ollama = {
      id: `chatcmpl-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: c.model || s.model,
    };
  }

  const { id, created, model } = s.ollama;

  // Final chunk with done=true
  if (c.done) {
    const usage = extractUsage(c);

    // Determine finish_reason based on done_reason and previous tool_calls
    let finishReason = "stop";
    if (c.done_reason === "tool_calls" || s.hadToolCalls) {
      finishReason = "tool_calls";
    }

    return {
      id: id,
      object: "chat.completion.chunk",
      created: created,
      model: model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
      usage: usage,
    };
  }

  // Content chunk
  const message = c.message;
  if (!message) return null;

  const content = typeof message.content === "string" ? message.content : "";
  const thinking = typeof message.thinking === "string" ? message.thinking : "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;

  // Skip empty chunks
  if (!content && !thinking && !toolCalls) return null;

  // Accumulate content in state
  if (content) {
    s.accumulatedContent = (s.accumulatedContent || "") + content;
  }
  if (thinking) {
    s.accumulatedThinking = (s.accumulatedThinking || "") + thinking;
  }

  const delta: Record<string, unknown> = {};
  if (!s.ollama.sentRole) {
    delta.role = "assistant";
    s.ollama.sentRole = true;
  }
  if (content) delta.content = content;
  if (thinking) delta.reasoning_content = thinking;

  // Convert Ollama tool_calls to OpenAI format
  if (toolCalls) {
    s.hadToolCalls = true;
    delta.tool_calls = convertToolCalls(toolCalls);
  }

  return {
    id: id,
    object: "chat.completion.chunk",
    created: created,
    model: model,
    choices: [
      {
        index: 0,
        delta: delta,
        finish_reason: null,
      },
    ],
  };
}

/**
 * Extract usage stats from Ollama response
 */
function extractUsage(ollamaChunk: OllamaChunk) {
  return {
    prompt_tokens: ollamaChunk.prompt_eval_count || 0,
    completion_tokens: ollamaChunk.eval_count || 0,
    total_tokens: (ollamaChunk.prompt_eval_count || 0) + (ollamaChunk.eval_count || 0),
  };
}

/**
 * Convert tool_calls from Ollama format to OpenAI format
 */
function convertToolCalls(toolCalls: OllamaToolCall[]) {
  return toolCalls.map((tc, i) => ({
    index: tc.function?.index ?? i,
    id: tc.id || `call_${i}_${Date.now()}`,
    type: "function",
    function: {
      name: tc.function?.name || "",
      arguments:
        typeof tc.function?.arguments === "string"
          ? tc.function.arguments
          : JSON.stringify(tc.function?.arguments || {}),
    },
  }));
}

/**
 * Convert Ollama non-streaming response body to OpenAI chat.completion format
 */
export function ollamaBodyToOpenAI(body: unknown) {
  const b = body as OllamaChunk;
  const msg: OllamaMessage = b.message || {};
  const content = msg.content || "";
  const thinking = msg.thinking || "";
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

  const message: Record<string, unknown> = { role: "assistant" };
  if (content) message.content = content;
  if (thinking) message.reasoning_content = thinking;
  if (toolCalls.length > 0) message.tool_calls = convertToolCalls(toolCalls);
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = b.done_reason || "stop";
  if (toolCalls.length > 0) finishReason = "tool_calls";

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: b.model || "ollama",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: extractUsage(b),
  };
}

// Register translator
register(FORMATS.OLLAMA, FORMATS.OPENAI, null, ollamaToOpenAI);
