// OpenAI helper functions for translator

// Request bodies reach this helper as unvalidated JSON records from the
// translator pipeline; the types below describe the shapes it emits.
type JsonRecord = Record<string, unknown>;

type OpenAIContentBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type OpenAIMessage = {
  role?: string;
  content?: string | OpenAIContentBlock[];
  tool_calls?: unknown;
  [key: string]: unknown;
};

type GeminiFunctionDeclaration = {
  name?: string;
  description?: string;
  parameters?: unknown;
  [key: string]: unknown;
};

type OpenAITool = {
  type?: string;
  function?: unknown;
  name?: string;
  description?: string;
  input_schema?: unknown;
  functionDeclarations?: GeminiFunctionDeclaration[];
  [key: string]: unknown;
};

type ToolChoice = {
  type?: string;
  name?: string;
  [key: string]: unknown;
};

// Valid OpenAI content block types
export const VALID_OPENAI_CONTENT_TYPES = [
  "text",
  "image_url",
  "image",
  "input_audio",
  "audio_url",
];
export const VALID_OPENAI_MESSAGE_TYPES = [
  "text",
  "image_url",
  "image",
  "tool_calls",
  "tool_result",
];

// Filter messages to OpenAI standard format
// Remove: thinking, redacted_thinking, signature, and other non-OpenAI blocks
export function filterToOpenAIFormat(body: JsonRecord) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const messages = body.messages as OpenAIMessage[];

  body.messages = messages.map((msg) => {
    // Normalize developer role to system (many providers don't support developer)
    if (msg.role === "developer") msg = { ...msg, role: "system" };

    // Keep tool messages as-is (OpenAI format)
    if (msg.role === "tool") return msg;

    // Keep assistant messages with tool_calls as-is
    if (msg.role === "assistant" && msg.tool_calls) return msg;

    // Handle string content
    if (typeof msg.content === "string") return msg;

    // Handle array content
    if (Array.isArray(msg.content)) {
      const filteredContent: OpenAIContentBlock[] = [];

      for (const block of msg.content) {
        // Skip thinking blocks
        if (block.type === "thinking" || block.type === "redacted_thinking") continue;

        // Only keep valid OpenAI content types
        // Runtime blocks always carry a type; includes(undefined) is false either way.
        if (VALID_OPENAI_CONTENT_TYPES.includes(block.type as string)) {
          // Remove signature field if exists
          const { signature: _signature, cache_control: _cache_control, ...cleanBlock } = block;
          filteredContent.push(cleanBlock);
        } else if (block.type === "tool_use") {
        } else if (block.type === "tool_result") {
          // Keep tool_result but clean it
          const { signature: _signature, cache_control: _cache_control, ...cleanBlock } = block;
          filteredContent.push(cleanBlock);
        }
      }

      // If all content was filtered, add empty text
      if (filteredContent.length === 0) {
        filteredContent.push({ type: "text", text: "" });
      }

      const allText = filteredContent.every((b) => b.type === "text");
      return {
        ...msg,
        content: allText ? filteredContent.map((b) => b.text).join("\n") : filteredContent,
      };
    }

    return msg;
  });

  // Filter out messages with only empty text (but NEVER filter tool messages
  // or user messages — removing a user message can leave two assistant messages
  // adjacent, causing upstream "Cannot continue from message role: assistant").
  body.messages = (body.messages as OpenAIMessage[]).filter((msg) => {
    // Always keep tool messages
    if (msg.role === "tool") return true;
    // Always keep assistant messages with tool_calls
    if (msg.role === "assistant" && msg.tool_calls) return true;
    // Never remove user messages — empty content is still a valid turn boundary
    if (msg.role === "user") return true;

    if (typeof msg.content === "string") return msg.content.trim() !== "";
    if (Array.isArray(msg.content)) {
      return msg.content.some((b) => (b.type === "text" && b.text?.trim()) || b.type !== "text");
    }
    return true;
  });

  // Remove empty tools array (some providers like QWEN reject it)
  if (body.tools && Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
  }

  // Normalize tools to OpenAI format (from Claude, Gemini, etc.)
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    body.tools = (body.tools as OpenAITool[]).flatMap((tool) => {
      // Already OpenAI format
      if (tool.type === "function" && tool.function) return tool;

      // Claude format: {name, description, input_schema}
      if (tool.name && (tool.input_schema || tool.description)) {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: String(tool.description || ""),
            parameters: tool.input_schema || { type: "object", properties: {} },
          },
        };
      }

      // Gemini format: {functionDeclarations: [{name, description, parameters}]}
      if (tool.functionDeclarations && Array.isArray(tool.functionDeclarations)) {
        return tool.functionDeclarations.map((fn) => ({
          type: "function",
          function: {
            name: fn.name,
            description: String(fn.description || ""),
            parameters: fn.parameters || { type: "object", properties: {} },
          },
        }));
      }

      return tool;
    });
  }

  // Normalize tool_choice to OpenAI format
  if (body.tool_choice && typeof body.tool_choice === "object") {
    const choice = body.tool_choice as ToolChoice;
    // Claude format: {type: "auto|any|tool", name?: "..."}
    if (choice.type === "auto") {
      body.tool_choice = "auto";
    } else if (choice.type === "any") {
      body.tool_choice = "required";
    } else if (choice.type === "tool" && choice.name) {
      body.tool_choice = { type: "function", function: { name: choice.name } };
    }
  }

  return body;
}
