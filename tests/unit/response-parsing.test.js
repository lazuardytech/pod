/**
 * Response parsing tests: validate streaming chunk parsers translate
 * upstream provider wire formats into correct OpenAI-format chunks.
 *
 * Covers 4 categories:
 *   1. Streaming chunk parsing (Claude, Gemini, Ollama, OpenAI→Claude reverse)
 *   2. Tool calls (Claude tool_use, Gemini functionCall, OpenAI tool_calls,
 *      OpenAI→Antigravity accumulation)
 *   3. Vision multi-part (Claude→OpenAI image input, Gemini inlineData output,
 *      OpenAI→Claude image input)
 *   4. Reasoning / thinking (Claude thinking, Gemini thought, OpenAI reasoning,
 *      non-streaming Claude with thinking+tool_use)
 *
 * All fixtures are inline — no network calls.
 * No source code modifications unless a bug is found.
 */

import { describe, expect, it } from "vitest";

import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { ollamaToOpenAI } from "../../open-sse/translator/response/ollama-to-openai.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClaudeState(toolNameMap) {
  return {
    messageId: null,
    model: null,
    toolCallIndex: 0,
    toolCalls: new Map(),
    toolNameMap: toolNameMap || new Map(),
    textBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    serverToolBlockIndex: -1,
    thinkingBlockStarted: false,
  };
}

function createGeminiState() {
  return {
    messageId: null,
    model: null,
    functionIndex: 0,
    toolCalls: new Map(),
    finishReason: null,
    usage: null,
  };
}

// ---------------------------------------------------------------------------
// Category 1: Streaming chunk parsing
// ---------------------------------------------------------------------------

describe("Streaming chunk parsing", () => {
  it("Claude stream: text-only chunks produce correct OpenAI chunks", () => {
    const state = createClaudeState();

    // message_start
    const s1 = claudeToOpenAIResponse(
      { type: "message_start", message: { id: "msg_abc", model: "claude-sonnet-4" } },
      state,
    );
    expect(s1).toHaveLength(1);
    expect(s1[0].id).toBe("chatcmpl-msg_abc");
    expect(s1[0].choices[0].delta.role).toBe("assistant");

    // content_block_start (text)
    const s2 = claudeToOpenAIResponse(
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      state,
    );
    expect(s2).toBeNull(); // text block start returns null (no delta)

    // content_block_delta
    const s3 = claudeToOpenAIResponse(
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      state,
    );
    expect(s3[0].choices[0].delta.content).toBe("Hello");

    const s4 = claudeToOpenAIResponse(
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      state,
    );
    expect(s4[0].choices[0].delta.content).toBe(" world");

    // message_delta with end_turn
    const s5 = claudeToOpenAIResponse(
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 10, output_tokens: 3 },
      },
      state,
    );
    expect(s5[0].choices[0].finish_reason).toBe("stop");
    expect(s5[0].usage.prompt_tokens).toBe(10);
    expect(s5[0].usage.completion_tokens).toBe(3);

    // message_stop — already sent finish, so should not re-emit
    const s6 = claudeToOpenAIResponse({ type: "message_stop" }, state);
    expect(s6).toBeNull();
  });

  it("Gemini stream: text-only chunks produce correct OpenAI chunks", () => {
    const state = createGeminiState();

    // First chunk — emits role + text
    const g1 = geminiToOpenAIResponse(
      {
        responseId: "resp_1",
        modelVersion: "gemini-2.5-flash",
        candidates: [{ content: { parts: [{ text: "Hello" }] } }],
      },
      state,
    );
    expect(g1).toHaveLength(2); // role chunk + text chunk
    expect(g1[0].choices[0].delta.role).toBe("assistant");
    expect(g1[1].choices[0].delta.content).toBe("Hello");

    // Second chunk — text only (no re-emit of role)
    const g2 = geminiToOpenAIResponse(
      {
        candidates: [{ content: { parts: [{ text: " world" }] } }],
      },
      state,
    );
    expect(g2).toHaveLength(1);
    expect(g2[0].choices[0].delta.content).toBe(" world");
    expect(g2[0].choices[0].delta.role).toBeUndefined();
  });

  it("Gemini stream: finishReason triggers final chunk with stop", () => {
    const state = createGeminiState();

    geminiToOpenAIResponse(
      {
        responseId: "resp_2",
        modelVersion: "gemini-2.5-flash",
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
      },
      state,
    );

    const g2 = geminiToOpenAIResponse(
      {
        candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
      },
      state,
    );
    expect(g2).toHaveLength(1);
    expect(g2[0].choices[0].finish_reason).toBe("stop");
    expect(g2[0].usage.prompt_tokens).toBe(5);
    expect(g2[0].usage.completion_tokens).toBe(3);
  });

  it("Ollama stream: content and thinking chunks produce correct OpenAI chunks", () => {
    const state = { ollama: null, accumulatedContent: "", accumulatedThinking: "" };

    // Chunk with content
    const o1 = ollamaToOpenAI(
      { model: "deepseek-r1", message: { role: "assistant", content: "Hello" }, done: false },
      state,
    );
    expect(o1.choices[0].delta.content).toBe("Hello");
    expect(o1.choices[0].finish_reason).toBeNull();

    // Chunk with thinking
    const o2 = ollamaToOpenAI({ message: { role: "assistant", thinking: "I reason" }, done: false }, state);
    expect(o2.choices[0].delta.reasoning_content).toBe("I reason");
    expect(o2.choices[0].delta.content).toBeUndefined();

    // Chunk with both
    const o3 = ollamaToOpenAI(
      { message: { role: "assistant", content: " world", thinking: " deeper" }, done: false },
      state,
    );
    expect(o3.choices[0].delta.content).toBe(" world");
    expect(o3.choices[0].delta.reasoning_content).toBe(" deeper");

    // Final done chunk
    const o4 = ollamaToOpenAI({ done: true, prompt_eval_count: 42, eval_count: 7, done_reason: "stop" }, state);
    expect(o4.choices[0].finish_reason).toBe("stop");
    expect(o4.usage.prompt_tokens).toBe(42);
    expect(o4.usage.completion_tokens).toBe(7);
  });

  it("OpenAI stream → Claude stream: reverse translation emits correct Claude events", () => {
    const state = {
      messageStartSent: false,
      messageId: null,
      model: null,
      nextBlockIndex: 0,
      textBlockStarted: false,
      textBlockIndex: null,
      textBlockClosed: false,
      thinkingBlockStarted: false,
      thinkingBlockIndex: null,
      toolCalls: new Map(),
      finishReason: null,
      usage: null,
    };

    // First OpenAI chunk (role + content)
    const c1 = openaiToClaudeResponse(
      {
        id: "chatcmpl-abcdefghij",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }],
      },
      state,
    );
    // message_start + content_block_start + content_block_delta
    expect(c1[0].type).toBe("message_start");
    // messageId = chunk.id stripped of "chatcmpl-" prefix, must be ≥ 8 chars
    expect(c1[0].message.id).toBe("abcdefghij");
    expect(c1[1].type).toBe("content_block_start");
    expect(c1[2].type).toBe("content_block_delta");
    expect(c1[2].delta.text).toBe("Hi");

    // Second content delta
    const c2 = openaiToClaudeResponse(
      {
        id: "chatcmpl-abcdefghij",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [{ index: 0, delta: { content: " there!" }, finish_reason: null }],
      },
      state,
    );
    expect(c2[0].type).toBe("content_block_delta");
    expect(c2[0].delta.text).toBe(" there!");

    // Final chunk
    const c3 = openaiToClaudeResponse(
      {
        id: "chatcmpl-abcdefghij",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
      state,
    );
    expect(c3[0].type).toBe("content_block_stop");
    expect(c3[1].type).toBe("message_delta");
    expect(c3[1].delta.stop_reason).toBe("end_turn");
    expect(c3[2].type).toBe("message_stop");
  });

  it("Claude stream: null/empty chunks return null gracefully", () => {
    const state = createClaudeState();
    expect(claudeToOpenAIResponse(null, state)).toBeNull();
    expect(claudeToOpenAIResponse({}, state)).toBeNull();
    expect(claudeToOpenAIResponse({ type: "ping" }, state)).toBeNull();
  });

  it("Gemini stream: null/empty chunks return null gracefully", () => {
    const state = createGeminiState();
    expect(geminiToOpenAIResponse(null, state)).toBeNull();
    expect(geminiToOpenAIResponse({}, state)).toBeNull();
    expect(geminiToOpenAIResponse({ candidates: [] }, state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Category 2: Tool calls
// ---------------------------------------------------------------------------

describe("Tool calls", () => {
  it("Claude stream: tool_use blocks convert to OpenAI tool_calls with name mapping", () => {
    const state = createClaudeState(new Map([["proxy_read_file", "read_file"]]));

    // Start message
    claudeToOpenAIResponse({ type: "message_start", message: { id: "msg_t1", model: "claude-sonnet-4" } }, state);

    // tool_use content_block_start
    const t1 = claudeToOpenAIResponse(
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "proxy_read_file" },
      },
      state,
    );
    expect(t1[0].choices[0].delta.tool_calls).toHaveLength(1);
    expect(t1[0].choices[0].delta.tool_calls[0].id).toBe("toolu_1");
    expect(t1[0].choices[0].delta.tool_calls[0].function.name).toBe("read_file");
    expect(t1[0].choices[0].delta.tool_calls[0].function.arguments).toBe("");

    // Argument delta
    const t2 = claudeToOpenAIResponse(
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"path":' },
      },
      state,
    );
    expect(t2[0].choices[0].delta.tool_calls[0].function.arguments).toBe('{"path":');

    // Additional argument delta
    const t3 = claudeToOpenAIResponse(
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '"/tmp/a"}' },
      },
      state,
    );
    expect(t3[0].choices[0].delta.tool_calls[0].function.arguments).toBe('"/tmp/a"}');
  });

  it("Gemini stream: functionCall parts convert to OpenAI tool_calls", () => {
    const state = createGeminiState();

    const g1 = geminiToOpenAIResponse(
      {
        responseId: "resp_fc_1",
        modelVersion: "gemini-2.5-pro",
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "get_weather", args: { city: "Tokyo" } } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
      state,
    );

    // role chunk + tool_call chunk + finish chunk
    expect(g1).toHaveLength(3);
    // tool_call chunk
    const toolChunk = g1.find((c) => c.choices[0].delta.tool_calls);
    expect(toolChunk).toBeDefined();
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("get_weather");
    expect(JSON.parse(toolChunk.choices[0].delta.tool_calls[0].function.arguments)).toEqual({ city: "Tokyo" });

    // finish chunk should have tool_calls reason
    const finishChunk = g1.find((c) => c.choices[0].finish_reason);
    expect(finishChunk.choices[0].finish_reason).toBe("tool_calls");
  });

  it("OpenAI tool_calls delta → Claude stream: tool_use blocks and input_json_deltas", () => {
    const state = {
      messageStartSent: false,
      messageId: null,
      model: null,
      nextBlockIndex: 0,
      textBlockStarted: false,
      textBlockIndex: null,
      textBlockClosed: false,
      thinkingBlockStarted: false,
      thinkingBlockIndex: null,
      toolCalls: new Map(),
      finishReason: null,
      usage: null,
    };

    // Tool call start with id and name
    const t1 = openaiToClaudeResponse(
      {
        id: "chatcmpl-tc1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      state,
    );

    expect(t1[0].type).toBe("message_start");
    expect(t1[1].type).toBe("content_block_start");
    expect(t1[1].content_block.type).toBe("tool_use");
    expect(t1[1].content_block.name).toBe("get_weather");

    // Argument delta
    const t2 = openaiToClaudeResponse(
      {
        id: "chatcmpl-tc1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"city":"Tokyo"}' } }],
            },
            finish_reason: null,
          },
        ],
      },
      state,
    );
    expect(t2[0].type).toBe("content_block_delta");
    expect(t2[0].delta.type).toBe("input_json_delta");
    expect(t2[0].delta.partial_json).toBe('{"city":"Tokyo"}');

    // Finish
    const t3 = openaiToClaudeResponse(
      {
        id: "chatcmpl-tc1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
      state,
    );
    expect(t3[0].type).toBe("content_block_stop");
    expect(t3[1].delta.stop_reason).toBe("tool_use");
  });

  it("OpenAI → Antigravity: tool calls accumulate and emit as single functionCall at finish", () => {
    const state = {};

    // First tool call delta (name + args start)
    const a1 = openaiToAntigravityResponse(
      {
        id: "chatcmpl-ag1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "search", arguments: "" } }],
            },
            finish_reason: null,
          },
        ],
      },
      state,
    );
    // Should not emit yet — waits for finish_reason
    expect(a1).toBeNull();

    // Second tool call delta (arguments)
    const a2 = openaiToAntigravityResponse(
      {
        id: "chatcmpl-ag1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"query":"weather"}' } }],
            },
            finish_reason: null,
          },
        ],
      },
      state,
    );
    expect(a2).toBeNull();

    // Finish chunk — emits accumulated tool call
    const a3 = openaiToAntigravityResponse(
      {
        id: "chatcmpl-ag1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
      state,
    );

    expect(a3.response.candidates[0].content.parts).toHaveLength(1);
    expect(a3.response.candidates[0].content.parts[0].functionCall.name).toBe("search");
    expect(a3.response.candidates[0].content.parts[0].functionCall.args).toEqual({ query: "weather" });
    expect(a3.response.candidates[0].finishReason).toBe("STOP");
  });
});

// ---------------------------------------------------------------------------
// Category 3: Vision multi-part input → response
// ---------------------------------------------------------------------------

describe("Vision multi-part", () => {
  it("Claude request with image → OpenAI: converts to image_url format", () => {
    const body = {
      model: "claude-sonnet-4",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "c29tZS1pbWFnZS1kYXRh",
              },
            },
          ],
        },
      ],
    };

    const result = claudeToOpenAIRequest("gpt-4o", body, false);

    // Result should have image_url in the user message
    const userMsg = result.messages.find((m) => m.role === "user");
    expect(Array.isArray(userMsg.content)).toBe(true);

    const imagePart = userMsg.content.find((p) => p.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toBe("data:image/jpeg;base64,c29tZS1pbWFnZS1kYXRh");
  });

  it("Gemini response: inlineData in parts generates image content in OpenAI output", () => {
    const state = createGeminiState();

    const g1 = geminiToOpenAIResponse(
      {
        responseId: "resp_img_1",
        modelVersion: "gemini-2.5-pro",
        candidates: [
          {
            content: {
              parts: [
                { text: "Here is the image:" },
                { inlineData: { mimeType: "image/png", data: "aW1hZ2UtYmluYXJ5" } },
              ],
            },
          },
        ],
      },
      state,
    );

    // Role + text + image chunks
    const textChunk = g1.find((c) => c.choices[0].delta.content === "Here is the image:");
    expect(textChunk).toBeDefined();

    const imageChunk = g1.find((c) => c.choices[0].delta.images);
    expect(imageChunk).toBeDefined();
    expect(imageChunk.choices[0].delta.images[0].type).toBe("image_url");
    expect(imageChunk.choices[0].delta.images[0].image_url.url).toBe("data:image/png;base64,aW1hZ2UtYmluYXJ5");
  });

  it("OpenAI request with image_url → Claude: converts to Claude image source", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } },
          ],
        },
      ],
    };

    const result = openaiToClaudeRequest("claude-sonnet-4", body, false);

    // Claude format: content array with image source blocks
    const userMsg = result.messages.find((m) => m.role === "user");
    expect(Array.isArray(userMsg.content)).toBe(true);
    const imageBlock = userMsg.content.find((p) => p.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe("base64");
    expect(imageBlock.source.media_type).toBe("image/png");
    expect(imageBlock.source.data).toBe("ZmFrZQ==");
  });
});

// ---------------------------------------------------------------------------
// Category 4: Reasoning / thinking
// ---------------------------------------------------------------------------

describe("Reasoning / thinking content", () => {
  it("Claude stream: thinking blocks convert to reasoning_content chunks", () => {
    const state = createClaudeState();

    claudeToOpenAIResponse({ type: "message_start", message: { id: "msg_think_1", model: "claude-sonnet-4" } }, state);

    // thinking block start → emits <think> tag
    const t1 = claudeToOpenAIResponse(
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      state,
    );
    expect(t1[0].choices[0].delta.content).toBe("<think>");

    // thinking delta
    const t2 = claudeToOpenAIResponse(
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me reason step by step." },
      },
      state,
    );
    expect(t2[0].choices[0].delta.reasoning_content).toBe("Let me reason step by step.");

    // thinking block stop → emits </think>
    const t3 = claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state);
    expect(t3[0].choices[0].delta.content).toBe("</think>");
  });

  it("Gemini stream: thought:true parts map to reasoning_content, not content", () => {
    const state = createGeminiState();

    const g1 = geminiToOpenAIResponse(
      {
        responseId: "resp_think_1",
        modelVersion: "gemini-2.5-pro",
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "Internal reasoning", thoughtSignature: "sig_abc" },
                { text: "Final answer here" },
              ],
            },
          },
        ],
      },
      state,
    );

    // Role + reasoning chunk + text chunk
    const reasoningChunks = g1.filter((c) => c.choices[0].delta.reasoning_content);
    expect(reasoningChunks).toHaveLength(1);
    expect(reasoningChunks[0].choices[0].delta.reasoning_content).toBe("Internal reasoning");

    const textChunks = g1.filter((c) => c.choices[0].delta.content && !c.choices[0].delta.role);
    expect(textChunks).toHaveLength(1);
    expect(textChunks[0].choices[0].delta.content).toBe("Final answer here");
  });

  it("Gemini stream: thoughtSignature without thought:true maps text to content", () => {
    // When a part has thoughtSignature but no thought:true flag, the code maps to content
    // (only parts with thought:true map to reasoning_content)
    const state = createGeminiState();

    const g1 = geminiToOpenAIResponse(
      {
        responseId: "resp_sig_1",
        modelVersion: "gemini-2.5-pro",
        candidates: [
          {
            content: {
              parts: [{ text: "Reasoning text", thoughtSignature: "sig_xyz" }, { text: "Regular output" }],
            },
          },
        ],
      },
      state,
    );

    // No thought:true flag => no reasoning_content
    const reasoningChunks = g1.filter((c) => c.choices[0].delta.reasoning_content);
    expect(reasoningChunks).toHaveLength(0);

    // Both parts go to content
    const textChunks = g1.filter((c) => c.choices[0].delta.content && !c.choices[0].delta.role);
    expect(textChunks).toHaveLength(2);
    expect(textChunks[0].choices[0].delta.content).toBe("Reasoning text");
    expect(textChunks[1].choices[0].delta.content).toBe("Regular output");
  });

  it("OpenAI reasoning_content → Claude stream: creates thinking block", () => {
    const state = {
      messageStartSent: false,
      messageId: null,
      model: null,
      nextBlockIndex: 0,
      textBlockStarted: false,
      textBlockIndex: null,
      textBlockClosed: false,
      thinkingBlockStarted: false,
      thinkingBlockIndex: null,
      toolCalls: new Map(),
      finishReason: null,
      usage: null,
    };

    // OpenAI chunk with reasoning_content
    const c1 = openaiToClaudeResponse(
      {
        id: "chatcmpl-r1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "deepseek-reasoner",
        choices: [
          {
            index: 0,
            delta: { reasoning_content: "Let me think..." },
            finish_reason: null,
          },
        ],
      },
      state,
    );

    // message_start + thinking content_block_start + thinking delta
    expect(c1[0].type).toBe("message_start");
    expect(c1[1].type).toBe("content_block_start");
    expect(c1[1].content_block.type).toBe("thinking");
    expect(c1[2].type).toBe("content_block_delta");
    expect(c1[2].delta.type).toBe("thinking_delta");
    expect(c1[2].delta.thinking).toBe("Let me think...");

    // Subsequent reasoning delta
    const c2 = openaiToClaudeResponse(
      {
        id: "chatcmpl-r1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "deepseek-reasoner",
        choices: [{ index: 0, delta: { reasoning_content: "more reasoning" }, finish_reason: null }],
      },
      state,
    );
    expect(c2[0].delta.thinking).toBe("more reasoning");
  });

  it("Non-streaming: Claude → OpenAI translates thinking + text + tool_use in one response", () => {
    const claudeResponse = {
      id: "msg_ns_1",
      model: "claude-sonnet-4-20250514",
      content: [
        { type: "thinking", thinking: "Let me analyze the problem." },
        { type: "text", text: "The answer is 42." },
        { type: "tool_use", id: "toolu_ns_1", name: "calculator", input: { expr: "6*7" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 15 },
    };

    const result = translateNonStreamingResponse(claudeResponse, FORMATS.CLAUDE, FORMATS.OPENAI);

    expect(result.choices[0].message.content).toBe("The answer is 42.");
    expect(result.choices[0].message.reasoning_content).toBe("Let me analyze the problem.");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0].function.name).toBe("calculator");
    expect(result.choices[0].message.tool_calls[0].function.arguments).toBe('{"expr":"6*7"}');
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.usage.prompt_tokens).toBe(20);
    expect(result.usage.completion_tokens).toBe(15);
  });

  it("Non-streaming: Gemini → OpenAI translates thought parts and functionCall", () => {
    const geminiResponse = {
      responseId: "resp_ns_2",
      modelVersion: "gemini-2.5-pro",
      createTime: "2026-05-28T00:00:00Z",
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "Internal reasoning process" },
              { text: "The result is Tokyo." },
              { functionCall: { name: "get_population", args: { city: "Tokyo" } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8, thoughtsTokenCount: 3, totalTokenCount: 26 },
    };

    const result = translateNonStreamingResponse(geminiResponse, FORMATS.GEMINI, FORMATS.OPENAI);

    expect(result.choices[0].message.reasoning_content).toBe("Internal reasoning process");
    expect(result.choices[0].message.content).toBe("The result is Tokyo.");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0].function.name).toBe("get_population");
    expect(result.choices[0].message.tool_calls[0].function.arguments).toBe('{"city":"Tokyo"}');
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.usage.completion_tokens_details.reasoning_tokens).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("Ollama: empty chunks return null", () => {
    expect(ollamaToOpenAI(null, {})).toBeNull();
    expect(ollamaToOpenAI({}, {})).toBeNull();
    expect(ollamaToOpenAI({ done: false, message: {} }, { ollama: null })).toBeNull();
  });

  it("Gemini: Antigravity wrapper (chunk.response) is extracted correctly", () => {
    const state = createGeminiState();

    const g1 = geminiToOpenAIResponse(
      {
        response: {
          responseId: "ag_1",
          modelVersion: "gemini-3-pro",
          candidates: [{ content: { parts: [{ text: "Antigravity wrapped" }] } }],
        },
      },
      state,
    );

    expect(g1[0].choices[0].delta.role).toBe("assistant");
    expect(g1[1].choices[0].delta.content).toBe("Antigravity wrapped");
  });

  it("Claude stream: message_delta includes cache tokens in usage", () => {
    const state = createClaudeState();
    claudeToOpenAIResponse({ type: "message_start", message: { id: "msg_cache_1", model: "claude-sonnet-4" } }, state);

    const result = claudeToOpenAIResponse(
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          input_tokens: 50,
          output_tokens: 10,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 5,
        },
      },
      state,
    );

    // prompt_tokens = input_tokens + cache_read + cache_creation = 50 + 30 + 5 = 85
    expect(result[0].usage.prompt_tokens).toBe(85);
    expect(result[0].usage.completion_tokens).toBe(10);
    expect(result[0].usage.prompt_tokens_details?.cached_tokens).toBe(30);
    expect(result[0].usage.prompt_tokens_details?.cache_creation_tokens).toBe(5);
  });

  it("Non-streaming: same-format passthrough returns body unchanged", () => {
    const body = { id: "msg_1", content: [{ type: "text", text: "hi" }] };
    const result = translateNonStreamingResponse(body, FORMATS.CLAUDE, FORMATS.CLAUDE);
    expect(result).toBe(body);
  });
});
