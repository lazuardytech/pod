// @ts-nocheck
/**
 * Translator: OpenAI Chat Completions → OpenAI Responses API (response)
 * Converts streaming chunks from Chat Completions to Responses API events
 */

import { FORMATS } from "../formats.ts";
import { register } from "../registry.ts";

/**
 * Translate OpenAI chunk to Responses API events
 * @returns {Array} Array of events with { event, data } structure
 */
export function openaiToOpenAIResponsesResponse(chunk: unknown, state: unknown) {
  if (!chunk) {
    return flushEvents(state);
  }

  if (!chunk.choices?.length) return [];

  const events: unknown[] = [];
  const nextSeq = () => ++state.seq;

  const emit = (eventType: unknown, data: unknown) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  const choice = chunk.choices[0];
  const idx = choice.index || 0;
  const delta = choice.delta || {};

  // Emit initial events
  if (!state.started) {
    state.started = true;
    state.responseId = chunk.id ? `resp_${chunk.id}` : state.responseId;

    emit("response.created", {
      type: "response.created",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "in_progress",
        background: false,
        error: null,
        output: [],
      },
    });

    emit("response.in_progress", {
      type: "response.in_progress",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "in_progress",
      },
    });
  }

  // Handle reasoning_content
  if (delta.reasoning_content) {
    startReasoning(state, emit, idx);
    emitReasoningDelta(state, emit, delta.reasoning_content);
  }

  // Handle text content
  if (delta.content) {
    let content = delta.content;

    if (content.includes("<think>")) {
      state.inThinking = true;
      content = content.replace("<think>", "");
      startReasoning(state, emit, idx);
    }

    if (content.includes("</think>")) {
      const parts = content.split("</think>");
      const thinkPart = parts[0];
      const textPart = parts.slice(1).join("</think>");
      if (thinkPart) emitReasoningDelta(state, emit, thinkPart);
      closeReasoning(state, emit);
      state.inThinking = false;
      content = textPart;
    }

    if (state.inThinking && content) {
      emitReasoningDelta(state, emit, content);
      return events;
    }

    if (content) {
      emitTextContent(state, emit, idx, content);
    }
  }

  // Handle tool_calls
  if (delta.tool_calls) {
    closeMessage(state, emit, idx);
    for (const tc of delta.tool_calls) {
      emitToolCall(state, emit, tc);
    }
  }

  // Handle finish_reason
  if (choice.finish_reason) {
    for (const i in state.msgItemAdded) closeMessage(state, emit, i);
    closeReasoning(state, emit);
    for (const i in state.funcCallIds) closeToolCall(state, emit, i);
    sendCompleted(state, emit);
  }

  return events;
}

// Helper functions
function startReasoning(state: unknown, emit: unknown, idx: unknown) {
  if (!state.reasoningId) {
    state.reasoningId = `rs_${state.responseId}_${idx}`;
    state.reasoningIndex = idx;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: state.reasoningId, type: "reasoning", summary: [] },
    });

    emit("response.reasoning_summary_part.added", {
      type: "response.reasoning_summary_part.added",
      item_id: state.reasoningId,
      output_index: idx,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    });
    state.reasoningPartAdded = true;
  }
}

function emitReasoningDelta(state: unknown, emit: unknown, text: unknown) {
  if (!text) return;
  state.reasoningBuf += text;
  emit("response.reasoning_summary_text.delta", {
    type: "response.reasoning_summary_text.delta",
    item_id: state.reasoningId,
    output_index: state.reasoningIndex,
    summary_index: 0,
    delta: text,
  });
}

function closeReasoning(state: unknown, emit: unknown) {
  if (state.reasoningId && !state.reasoningDone) {
    state.reasoningDone = true;

    emit("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: state.reasoningBuf,
    });

    emit("response.reasoning_summary_part.done", {
      type: "response.reasoning_summary_part.done",
      item_id: state.reasoningId,
      output_index: state.reasoningIndex,
      summary_index: 0,
      part: { type: "summary_text", text: state.reasoningBuf },
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: state.reasoningIndex,
      item: {
        id: state.reasoningId,
        type: "reasoning",
        summary: [{ type: "summary_text", text: state.reasoningBuf }],
      },
    });
  }
}

function emitTextContent(state: unknown, emit: unknown, idx: unknown, content: unknown) {
  if (!state.msgItemAdded[idx]) {
    state.msgItemAdded[idx] = true;
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: idx,
      item: { id: msgId, type: "message", content: [], role: "assistant" },
    });
  }

  if (!state.msgContentAdded[idx]) {
    state.msgContentAdded[idx] = true;

    emit("response.content_part.added", {
      type: "response.content_part.added",
      item_id: `msg_${state.responseId}_${idx}`,
      output_index: idx,
      content_index: 0,
      part: { type: "output_text", annotations: [], logprobs: [], text: "" },
    });
  }

  emit("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: `msg_${state.responseId}_${idx}`,
    output_index: idx,
    content_index: 0,
    delta: content,
    logprobs: [],
  });

  if (!state.msgTextBuf[idx]) state.msgTextBuf[idx] = "";
  state.msgTextBuf[idx] += content;
}

function closeMessage(state: unknown, emit: unknown, idx: unknown) {
  if (state.msgItemAdded[idx] && !state.msgItemDone[idx]) {
    state.msgItemDone[idx] = true;
    const fullText = state.msgTextBuf[idx] || "";
    const msgId = `msg_${state.responseId}_${idx}`;

    emit("response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: parseInt(idx),
      content_index: 0,
      text: fullText,
      logprobs: [],
    });

    emit("response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: parseInt(idx),
      content_index: 0,
      part: { type: "output_text", annotations: [], logprobs: [], text: fullText },
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx),
      item: {
        id: msgId,
        type: "message",
        content: [{ type: "output_text", annotations: [], logprobs: [], text: fullText }],
        role: "assistant",
      },
    });
  }
}

function emitToolCall(state: unknown, emit: unknown, tc: unknown) {
  // Use tc.index if provided, otherwise fallback to state's tracked toolCallIndex
  // This fixes Codex streaming freeze where tool calls may not have explicit index
  let tcIdx = tc.index;
  if (tcIdx === undefined || tcIdx === null) {
    // Fallback: use state's tracked index (next available slot)
    tcIdx = state.toolCallIndex ?? 0;
    state.toolCallIndex = tcIdx + 1; // Increment for next tool call
  }

  const newCallId = tc.id;
  const funcName = tc.function?.name;

  if (funcName) state.funcNames[tcIdx] = funcName;

  if (!state.funcCallIds[tcIdx] && newCallId) {
    state.funcCallIds[tcIdx] = newCallId;

    emit("response.output_item.added", {
      type: "response.output_item.added",
      output_index: tcIdx,
      item: {
        id: `fc_${newCallId}`,
        type: "function_call",
        arguments: "",
        call_id: newCallId,
        name: state.funcNames[tcIdx] || "",
      },
    });
  }

  if (!state.funcArgsBuf[tcIdx]) state.funcArgsBuf[tcIdx] = "";

  if (tc.function?.arguments) {
    const refCallId = state.funcCallIds[tcIdx] || newCallId;
    if (refCallId) {
      emit("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${refCallId}`,
        output_index: tcIdx,
        delta: tc.function.arguments,
      });
    }
    state.funcArgsBuf[tcIdx] += tc.function.arguments;
  }
}

function closeToolCall(state: unknown, emit: unknown, idx: unknown) {
  const callId = state.funcCallIds[idx];
  if (callId && !state.funcItemDone[idx]) {
    const args = state.funcArgsBuf[idx] || "{}";

    emit("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: `fc_${callId}`,
      output_index: parseInt(idx),
      arguments: args,
    });

    emit("response.output_item.done", {
      type: "response.output_item.done",
      output_index: parseInt(idx),
      item: {
        id: `fc_${callId}`,
        type: "function_call",
        arguments: args,
        call_id: callId,
        name: state.funcNames[idx] || "",
      },
    });

    state.funcItemDone[idx] = true;
    state.funcArgsDone[idx] = true;
  }
}

function sendCompleted(state: unknown, emit: unknown) {
  if (!state.completedSent) {
    state.completedSent = true;
    emit("response.completed", {
      type: "response.completed",
      response: {
        id: state.responseId,
        object: "response",
        created_at: state.created,
        status: "completed",
        background: false,
        error: null,
      },
    });
  }
}

function flushEvents(state: unknown) {
  if (state.completedSent) return [];

  const events: unknown[] = [];
  const nextSeq = () => ++state.seq;
  const emit = (eventType: unknown, data: unknown) => {
    data.sequence_number = nextSeq();
    events.push({ event: eventType, data });
  };

  for (const i in state.msgItemAdded) closeMessage(state, emit, i);
  closeReasoning(state, emit);
  for (const i in state.funcCallIds) closeToolCall(state, emit, i);
  sendCompleted(state, emit);

  return events;
}

// currentToolCallId is intentionally sticky for the current turn so flush/completion
// can still finalize as tool_calls even if the tool call was emitted before stream end.
function computeFinishReason(state: unknown) {
  return state.nextToolCallIndex > 0 || state.currentToolCallId ? "tool_calls" : "stop";
}

/**
 * Translate OpenAI Responses API chunk to OpenAI Chat Completions format
 * This is for when Codex returns data and we need to send it to an OpenAI-compatible client
 */
export function openaiResponsesToOpenAIResponse(chunk: unknown, state: unknown) {
  if (!chunk) {
    // Flush: send final chunk with finish_reason
    if (state.finishReasonSent || !state.started) return null;

    const finishReason = computeFinishReason(state);

    state.finishReasonSent = true;
    state.finishReason = finishReason;

    const finalChunk: Record<string, unknown> = {
      id: state.chatId || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: state.created || Math.floor(Date.now() / 1000),
      model: state.model || "unknown",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: finishReason,
        },
      ],
    };

    if (state.usage && typeof state.usage === "object") {
      finalChunk.usage = state.usage;
    }

    return finalChunk;
  }

  // Handle different event types from Responses API
  const eventType = chunk.type || chunk.event;
  const data = chunk.data || chunk;

  // Initialize state
  if (!state.started) {
    state.started = true;
    state.chatId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.toolCallIndex = 0;
    state.currentToolCallId = null;
    state.maxOutputIndex = -1; // Track highest output_index seen
    // Map from Codex output_index → zero-based tool_call index.
    // Codex xhigh puts reasoning at output_index=0 and function_calls at
    // output_index=1,2,... Clients (pi, codex-cli) expect tool_calls[].index
    // to start at 0, so we remap via this map.
    state.outputIndexToToolCallIndex = new Map();
    state.nextToolCallIndex = 0;
  }

  // Text content delta
  if (eventType === "response.output_text.delta") {
    const delta = data.delta || "";
    if (!delta) return null;

    return {
      id: state.chatId,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model || "unknown",
      choices: [
        {
          index: 0,
          delta: { content: delta },
          finish_reason: null,
        },
      ],
    };
  }

  // Text content done (ignore, we handle via delta)
  if (eventType === "response.output_text.done") {
    return null;
  }

  // Function call started (standard function_call or custom_tool_call)
  if (
    eventType === "response.output_item.added" &&
    (data.item?.type === "function_call" || data.item?.type === "custom_tool_call")
  ) {
    const item = data.item;
    state.currentToolCallId = item.call_id || `call_${Date.now()}`;

    // Remap Codex output_index → zero-based tool_call index.
    // Codex xhigh places reasoning at output_index=0 and function_calls at
    // output_index=1,2,... Clients expect tool_calls[].index starting at 0.
    const outputIndex = data.output_index;
    if (outputIndex !== undefined && outputIndex !== null) {
      if (!state.outputIndexToToolCallIndex.has(outputIndex)) {
        state.outputIndexToToolCallIndex.set(outputIndex, state.nextToolCallIndex++);
      }
      state.toolCallIndex = state.outputIndexToToolCallIndex.get(outputIndex);
      state.maxOutputIndex = Math.max(state.maxOutputIndex, outputIndex);
    }

    return {
      id: state.chatId,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model || "unknown",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: state.toolCallIndex,
                id: state.currentToolCallId,
                type: "function",
                function: {
                  name: item.name || "",
                  arguments: "",
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
  }

  // Function call arguments delta (standard or custom_tool_call variant)
  if (
    eventType === "response.function_call_arguments.delta" ||
    eventType === "response.custom_tool_call_input.delta"
  ) {
    const argsDelta = data.delta || "";
    if (!argsDelta) return null;

    // Resolve remapped index from output_index if present, else use current toolCallIndex
    let tcIdx = state.toolCallIndex;
    const argOutputIndex = data.output_index;
    if (
      argOutputIndex !== undefined &&
      argOutputIndex !== null &&
      state.outputIndexToToolCallIndex?.has(argOutputIndex)
    ) {
      tcIdx = state.outputIndexToToolCallIndex.get(argOutputIndex);
    }

    return {
      id: state.chatId,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model || "unknown",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: tcIdx,
                function: { arguments: argsDelta },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
  }

  // Function call done (standard or custom_tool_call variant)
  // Do NOT increment toolCallIndex here — index is now managed by outputIndexToToolCallIndex map.
  if (
    eventType === "response.output_item.done" &&
    (data.item?.type === "function_call" || data.item?.type === "custom_tool_call")
  ) {
    return null;
  }

  // Response completed
  if (eventType === "response.completed") {
    // Extract usage from response.completed event
    const responseUsage = data.response?.usage;
    if (responseUsage && typeof responseUsage === "object") {
      const inputTokens = responseUsage.input_tokens || responseUsage.prompt_tokens || 0;
      const outputTokens = responseUsage.output_tokens || responseUsage.completion_tokens || 0;
      // OpenAI Responses API: input_tokens already includes cached_tokens
      // Cache info is in input_tokens_details.cached_tokens
      const cacheReadTokens =
        responseUsage.input_tokens_details?.cached_tokens ||
        responseUsage.cache_read_input_tokens ||
        0;

      state.usage = {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      };

      // Add prompt_tokens_details if cache tokens exist
      if (cacheReadTokens > 0) {
        state.usage.prompt_tokens_details = {
          cached_tokens: cacheReadTokens,
        };
      }
    }

    if (!state.finishReasonSent) {
      const finishReason = computeFinishReason(state);

      state.finishReasonSent = true;
      state.finishReason = finishReason; // Mark for usage injection in stream.js

      const finalChunk: Record<string, unknown> = {
        id: state.chatId,
        object: "chat.completion.chunk",
        created: state.created,
        model: state.model || "unknown",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finishReason,
          },
        ],
      };

      // Include usage in final chunk if available
      if (state.usage && typeof state.usage === "object") {
        finalChunk.usage = state.usage;
      }

      return finalChunk;
    }
    return null;
  }

  // Error events from Responses API (e.g. model_not_found)
  if (eventType === "error" || eventType === "response.failed") {
    // Avoid emitting duplicate errors (error + response.failed arrive back-to-back)
    if (state.finishReasonSent) return null;

    const error = data.error || data.response?.error;
    if (error) {
      state.error = error;
      state.finishReasonSent = true;

      // Surface the error as an OpenAI-compatible error chunk
      return {
        id: state.chatId || `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: state.created || Math.floor(Date.now() / 1000),
        model: state.model || "unknown",
        choices: [
          {
            index: 0,
            delta: { content: `[Error] ${error.message || JSON.stringify(error)}` },
            finish_reason: "stop",
          },
        ],
      };
    }
    return null;
  }

  // Reasoning events
  if (
    eventType === "response.reasoning_summary_text.delta" ||
    eventType === "response.reasoning_content_text.delta" ||
    eventType === "response.reasoning_text.delta"
  ) {
    const reasoningDelta = data.delta || "";
    if (!reasoningDelta) return null;
    return {
      id: state.chatId || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: state.created || Math.floor(Date.now() / 1000),
      model: state.model || "unknown",
      choices: [
        {
          index: 0,
          delta: { reasoning_content: reasoningDelta },
          finish_reason: null,
        },
      ],
    };
  }

  // Ignore other events
  return null;
}

// Register both directions
register(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, openaiToOpenAIResponsesResponse);
register(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, null, openaiResponsesToOpenAIResponse);
