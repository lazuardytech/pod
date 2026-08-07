import { SKIP_PATTERNS } from "../config/runtimeConfig.js";
import { detectFormat } from "../services/provider.js";
import { FORMATS } from "../translator/formats.js";
import { initState, translateResponse } from "../translator/index.js";
import { formatSSE } from "./stream.js";

type BypassResult = { success: true; response: Response };
type JsonRecord = Record<string, unknown>;
type TextPart = {
  text?: unknown;
  type?: string;
};
type BypassMessage = {
  content?: string | TextPart[];
  role?: string;
};
type BypassBody = JsonRecord & {
  messages?: BypassMessage[];
  stream?: boolean;
  system?: string | TextPart[];
};
type OpenAIResponse = ReturnType<typeof createOpenAIResponse>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

/**
 * Check for bypass patterns - return fake response without calling provider
 * Only works for Claude CLI requests
 */
export function handleBypassRequest(
  body: BypassBody,
  model: string,
  userAgent: string = "",
  ccFilterNaming: boolean = false,
): BypassResult | null {
  if (!userAgent.includes("claude-cli")) return null;
  if (!body.messages?.length) return null;

  const messages = body.messages;
  const getText = (content: unknown) => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c): c is TextPart => asRecord(c).type === "text")
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .join(" ");
    }
    return "";
  };

  let shouldBypass = false;
  let namingBypass = false;

  // Pattern 1: Title extraction (assistant message = "{")
  const lastMsg = messages[messages.length - 1];
  const firstContentPart = Array.isArray(lastMsg?.content) ? lastMsg.content[0] : undefined;
  if (lastMsg?.role === "assistant" && firstContentPart?.text === "{") {
    shouldBypass = true;
  }

  // Pattern 2: Warmup
  if (!shouldBypass) {
    const firstText = getText(messages[0]?.content);
    if (firstText === "Warmup") {
      shouldBypass = true;
    }
  }

  // Pattern 3: Count
  if (!shouldBypass && messages.length === 1 && messages[0]?.role === "user") {
    const firstText = getText(messages[0]?.content);
    if (firstText === "count") {
      shouldBypass = true;
    }
  }

  // Pattern 4: Skip patterns
  if (!shouldBypass && SKIP_PATTERNS?.length) {
    const userMessages = messages.filter((m) => m.role === "user");
    const userText = userMessages.map((m) => getText(m.content)).join(" ");
    if (SKIP_PATTERNS.some((p) => userText.includes(p))) {
      shouldBypass = true;
    }
  }

  // Pattern 5: CC naming request (topic title extraction by Claude Code CLI)
  // Claude format: system is top-level body.system field, not inside messages
  if (!shouldBypass && ccFilterNaming) {
    const systemMsg = messages.find((m) => m.role === "system");
    const systemFromMessages = getText(systemMsg?.content);
    const systemFromBody = Array.isArray(body.system)
      ? body.system
          .filter((s) => s.type === "text")
          .map((s) => (typeof s.text === "string" ? s.text : ""))
          .join(" ")
      : typeof body.system === "string"
        ? body.system
        : "";
    const systemText = systemFromMessages || systemFromBody;
    if (systemText.includes("isNewTopic")) {
      shouldBypass = true;
      namingBypass = true;
    }
  }

  if (!shouldBypass) return null;

  const sourceFormat = detectFormat(body);
  const stream = body.stream !== false;

  // For naming bypass, generate title from user message
  if (namingBypass) {
    const userMsg = messages.find((m) => m.role === "user");
    const userText = getText(userMsg?.content);
    const title = userText.trim().split(/\s+/).slice(0, 3).join(" ");
    const namingText = JSON.stringify({ isNewTopic: true, title });
    return stream
      ? createStreamingResponse(sourceFormat, model, namingText)
      : createNonStreamingResponse(sourceFormat, model, namingText);
  }

  return stream
    ? createStreamingResponse(sourceFormat, model, undefined)
    : createNonStreamingResponse(sourceFormat, model, undefined);
}

const DEFAULT_BYPASS_TEXT = "CLI Command Execution: Clear Terminal";

/**
 * Create OpenAI standard format response
 */
function createOpenAIResponse(model: string, text: string = DEFAULT_BYPASS_TEXT) {
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  };
}

/**
 * Create non-streaming response with translation
 * Use translator to convert OpenAI → sourceFormat
 */
function createNonStreamingResponse(
  sourceFormat: string,
  model: string,
  text?: string,
): BypassResult {
  const openaiResponse = createOpenAIResponse(model, text);

  // If sourceFormat is OpenAI, return directly
  if (sourceFormat === FORMATS.OPENAI) {
    return {
      success: true,
      response: new Response(JSON.stringify(openaiResponse), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  }

  // Use translator to convert: simulate streaming then collect all chunks
  const state = initState(sourceFormat);
  state.model = model;

  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);
  const allTranslated = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      allTranslated.push(...translated);
    }
  }

  // Flush remaining
  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    allTranslated.push(...flushed);
  }

  // For non-streaming, merge all chunks into final response
  const finalResponse = mergeChunksToResponse(allTranslated, sourceFormat);

  return {
    success: true,
    response: new Response(JSON.stringify(finalResponse), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

/**
 * Create streaming response with translation
 * Use translator to convert OpenAI chunks → sourceFormat
 */
function createStreamingResponse(sourceFormat: string, model: string, text?: string): BypassResult {
  const openaiResponse = createOpenAIResponse(model, text);
  const state = initState(sourceFormat);
  state.model = model;

  // Create OpenAI streaming chunks
  const openaiChunks = createOpenAIStreamingChunks(openaiResponse);

  // Translate each chunk to sourceFormat using translator
  const translatedChunks = [];

  for (const chunk of openaiChunks) {
    const translated = translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    if (translated?.length > 0) {
      for (const item of translated) {
        translatedChunks.push(formatSSE(item, sourceFormat));
      }
    }
  }

  // Flush remaining events
  const flushed = translateResponse(FORMATS.OPENAI, sourceFormat, null, state);
  if (flushed?.length > 0) {
    for (const item of flushed) {
      translatedChunks.push(formatSSE(item, sourceFormat));
    }
  }

  // Add [DONE]
  translatedChunks.push("data: [DONE]\n\n");

  return {
    success: true,
    response: new Response(translatedChunks.join(""), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}

/**
 * Merge translated chunks into final response object (for non-streaming)
 * Takes the last complete chunk as the final response
 */
function mergeChunksToResponse(chunks: unknown[], sourceFormat: string) {
  if (!chunks || chunks.length === 0) {
    return createOpenAIResponse("unknown");
  }

  // For most formats, the last chunk before done contains the complete response
  // Find the most complete chunk (usually the last one with content)
  let finalChunk = chunks[chunks.length - 1];

  // For Claude format, find the message_stop or final message
  if (sourceFormat === FORMATS.CLAUDE) {
    const messageStop = chunks.find((c) => asRecord(c).type === "message_stop");
    if (messageStop) {
      // Reconstruct complete message from chunks
      const _contentDelta = chunks.find((c) => asRecord(c).type === "content_block_delta");
      const messageDelta = asRecord(chunks.find((c) => asRecord(c).type === "message_delta"));
      const messageStart = asRecord(chunks.find((c) => asRecord(c).type === "message_start"));

      if (messageStart.message) {
        finalChunk = messageStart.message;
        // Merge usage if available
        const finalChunkRecord = asRecord(finalChunk);
        if (messageDelta.usage) {
          finalChunkRecord.usage = messageDelta.usage;
          finalChunk = finalChunkRecord;
        }
      }
    }
  }

  return finalChunk;
}

/**
 * Create OpenAI streaming chunks from complete response
 */
function createOpenAIStreamingChunks(completeResponse: OpenAIResponse) {
  const { id, created, model, choices } = completeResponse;
  const content = choices[0].message.content;

  return [
    // Chunk with content
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content,
          },
          finish_reason: null,
        },
      ],
    },
    // Final chunk with finish_reason
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
      usage: completeResponse.usage,
    },
  ];
}
