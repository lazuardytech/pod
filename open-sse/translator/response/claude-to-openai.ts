import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";

// Local shapes for the Claude stream events this translator consumes
type ClaudeMessageInfo = { id?: string; model?: string };

type ClaudeContentBlock =
  | { type: "server_tool_use" }
  | { type: "text" }
  | { type: "thinking" }
  | { type: "tool_use"; id: string; name: string };

type ClaudeDeltaInfo = {
  type?: string;
  text?: string;
  thinking?: string;
  partial_json?: string;
  stop_reason?: string;
};

type ClaudeUsageInfo = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
};

type ClaudeStreamEvent =
  | { type: "message_start"; message?: ClaudeMessageInfo }
  | { type: "content_block_start"; index: number; content_block?: ClaudeContentBlock }
  | { type: "content_block_delta"; index: number; delta?: ClaudeDeltaInfo }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: ClaudeDeltaInfo; usage?: ClaudeUsageInfo }
  | { type: "message_stop" };

type ClaudeToolCallInfo = {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// Usage tracked on state; cache fields are only added when present upstream
type ClaudeUsageState = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

// State fields this translator reads/writes (created per stream by initState)
type ClaudeToOpenAIState = {
  messageId: string | null;
  model: string | null | undefined;
  toolCallIndex: number;
  serverToolBlockIndex: number | undefined;
  textBlockStarted: boolean;
  thinkingBlockStarted: boolean;
  inThinkingBlock: boolean;
  currentBlockIndex: number | null;
  toolNameMap?: Map<string, string>;
  toolCalls: Map<number, ClaudeToolCallInfo>;
  usage: ClaudeUsageState | null;
  finishReason: string | null;
  finishReasonSent: boolean;
};

type OpenAIUsageDetails = { cached_tokens?: number; cache_creation_tokens?: number };

type OpenAIUsageChunk = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: OpenAIUsageDetails;
};

// Create OpenAI chunk helper
function createChunk(
  state: ClaudeToOpenAIState,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) {
  return {
    id: `chatcmpl-${state.messageId}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

// Convert Claude stream chunk to OpenAI format
export function claudeToOpenAIResponse(chunkInput: unknown, stateInput: unknown) {
  const chunk = chunkInput as ClaudeStreamEvent | null | undefined;
  const state = stateInput as ClaudeToOpenAIState;
  if (!chunk) return null;

  const results: unknown[] = [];
  const event = chunk.type;

  switch (event) {
    case "message_start": {
      state.messageId = chunk.message?.id || `msg_${Date.now()}`;
      state.model = chunk.message?.model;
      state.toolCallIndex = 0;
      results.push(createChunk(state, { role: "assistant" }));
      break;
    }

    case "content_block_start": {
      const block = chunk.content_block;
      if (block?.type === "server_tool_use") {
        // Built-in tool (web search) - Claude handles internally, skip
        state.serverToolBlockIndex = chunk.index;
        break;
      }
      if (block?.type === "text") {
        state.textBlockStarted = true;
      } else if (block?.type === "thinking") {
        state.inThinkingBlock = true;
        state.currentBlockIndex = chunk.index;
        // No content delta emitted here — thinking text flows via reasoning_content below
      } else if (block?.type === "tool_use") {
        const toolCallIndex = state.toolCallIndex++;
        // Restore original tool name from mapping (Claude OAuth)
        const toolName = state.toolNameMap?.get(block.name) || block.name;
        const toolCall: ClaudeToolCallInfo = {
          index: toolCallIndex,
          id: block.id,
          type: "function",
          function: {
            name: toolName,
            arguments: "",
          },
        };
        state.toolCalls.set(chunk.index, toolCall);
        results.push(createChunk(state, { tool_calls: [toolCall] }));
      }
      break;
    }

    case "content_block_delta": {
      // Skip deltas for built-in server tool blocks (web search)
      if (chunk.index === state.serverToolBlockIndex) break;
      const delta = chunk.delta;
      if (delta?.type === "text_delta" && delta.text) {
        results.push(createChunk(state, { content: delta.text }));
      } else if (delta?.type === "thinking_delta" && delta.thinking) {
        results.push(createChunk(state, { reasoning_content: delta.thinking }));
      } else if (delta?.type === "input_json_delta" && delta.partial_json) {
        const toolCall = state.toolCalls.get(chunk.index);
        if (toolCall) {
          toolCall.function.arguments += delta.partial_json;
          results.push(
            createChunk(state, {
              tool_calls: [
                {
                  index: toolCall.index,
                  id: toolCall.id,
                  function: { arguments: delta.partial_json },
                },
              ],
            }),
          );
        }
      }
      break;
    }

    case "content_block_stop": {
      // Skip stop for built-in server tool blocks (web search)
      if (chunk.index === state.serverToolBlockIndex) {
        state.serverToolBlockIndex = -1;
        break;
      }
      if (state.inThinkingBlock && chunk.index === state.currentBlockIndex) {
        // No content delta emitted — thinking end marker not needed in OpenAI format
        state.inThinkingBlock = false;
      }
      state.textBlockStarted = false;
      state.thinkingBlockStarted = false;
      break;
    }

    case "message_delta": {
      // Extract usage from message_delta event (Claude native format)
      // Normalize to OpenAI format (prompt_tokens/completion_tokens) for consistent logging
      if (chunk.usage && typeof chunk.usage === "object") {
        const inputTokens =
          typeof chunk.usage.input_tokens === "number" ? chunk.usage.input_tokens : 0;
        const outputTokens =
          typeof chunk.usage.output_tokens === "number" ? chunk.usage.output_tokens : 0;
        const cacheReadTokens =
          typeof chunk.usage.cache_read_input_tokens === "number"
            ? chunk.usage.cache_read_input_tokens
            : 0;
        const cacheCreationTokens =
          typeof chunk.usage.cache_creation_input_tokens === "number"
            ? chunk.usage.cache_creation_input_tokens
            : 0;

        // prompt_tokens = input_tokens + cache_read + cache_creation (all prompt-side tokens)
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;

        const usageInfo: ClaudeUsageState = {
          prompt_tokens: promptTokens,
          completion_tokens: outputTokens,
          total_tokens: promptTokens + outputTokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        };
        state.usage = usageInfo;

        if (cacheReadTokens > 0) state.usage.cache_read_input_tokens = cacheReadTokens;
        if (cacheCreationTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationTokens;
      }

      if (chunk.delta?.stop_reason) {
        state.finishReason = convertStopReason(chunk.delta.stop_reason);
        const finalChunk: Record<string, unknown> = {
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{ index: 0, delta: {}, finish_reason: state.finishReason }],
        };

        if (state.usage) {
          const finalUsage: OpenAIUsageChunk = {
            prompt_tokens: state.usage.prompt_tokens,
            completion_tokens: state.usage.completion_tokens,
            total_tokens: state.usage.total_tokens,
          };
          // Cache fields may be unset; `undefined > 0` is false at runtime
          const cacheRead = state.usage.cache_read_input_tokens as number;
          const cacheCreate = state.usage.cache_creation_input_tokens as number;
          if (cacheRead > 0 || cacheCreate > 0) {
            const promptTokensDetails: OpenAIUsageDetails = {};
            if (cacheRead > 0) promptTokensDetails.cached_tokens = cacheRead;
            if (cacheCreate > 0) promptTokensDetails.cache_creation_tokens = cacheCreate;
            finalUsage.prompt_tokens_details = promptTokensDetails;
          }
          finalChunk.usage = finalUsage;
        }

        results.push(finalChunk);
        state.finishReasonSent = true;
      }
      break;
    }

    case "message_stop": {
      if (!state.finishReasonSent) {
        const finishReason =
          state.finishReason || (state.toolCalls?.size > 0 ? "tool_calls" : "stop");
        const usageObj =
          state.usage && typeof state.usage === "object"
            ? {
                usage: {
                  prompt_tokens: state.usage.input_tokens || 0,
                  completion_tokens: state.usage.output_tokens || 0,
                  total_tokens: (state.usage.input_tokens || 0) + (state.usage.output_tokens || 0),
                },
              }
            : {};
        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason,
            },
          ],
          ...usageObj,
        });
        state.finishReasonSent = true;
      }
      break;
    }
  }

  return results.length > 0 ? results : null;
}

// Convert Claude stop_reason to OpenAI finish_reason
function convertStopReason(reason: unknown) {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "stop_sequence":
      return "stop";
    default:
      return "stop";
  }
}

// Register
register(FORMATS.CLAUDE, FORMATS.OPENAI, null, claudeToOpenAIResponse);
