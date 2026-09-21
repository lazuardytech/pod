import { FORMATS } from "../formats.ts";
import { adjustMaxTokens } from "../helpers/maxTokensHelper.ts";
import { register } from "../registry.ts";

type ClaudeSystemBlock = { text?: unknown };
type ClaudeTool = {
  name?: unknown;
  description?: unknown;
  input_schema?: unknown;
};
type ClaudeMessage = {
  role?: unknown;
  content?: unknown;
};
type ClaudePart = {
  type?: unknown;
  text?: unknown;
  image_url?: unknown;
};
type ClaudeToolChoice = {
  type?: unknown;
  name?: unknown;
  function?: { name?: unknown };
};
type ClaudeRequestBody = {
  max_tokens?: unknown;
  temperature?: unknown;
  system?: unknown;
  messages?: ClaudeMessage[];
  tools?: ClaudeTool[];
  tool_choice?: unknown;
};
type OpenAIToolMessage = {
  role?: unknown;
  tool_calls?: { id?: unknown }[];
  tool_call_id?: unknown;
};

// Convert Claude request to OpenAI format
export function claudeToOpenAIRequest(model: unknown, body: unknown, stream: unknown) {
  const req = body as ClaudeRequestBody; // trusted: registry passes Claude payloads
  const result: Record<string, unknown> & { messages: unknown[] } = {
    model: model,
    messages: [] as unknown[],
    stream: stream,
  };

  // Max tokens
  if (req.max_tokens) {
    result.max_tokens = adjustMaxTokens(body);
  }

  // Temperature
  if (req.temperature !== undefined) {
    result.temperature = req.temperature;
  }

  // System message
  if (req.system) {
    const systemContent = Array.isArray(req.system)
      ? req.system.map((s: ClaudeSystemBlock) => s.text || "").join("\n")
      : req.system;

    if (systemContent) {
      result.messages.push({
        role: "system",
        content: systemContent,
      });
    }
  }

  // Convert messages
  if (req.messages && Array.isArray(req.messages)) {
    for (let i = 0; i < req.messages.length; i++) {
      const msg = req.messages[i]!;
      const converted = convertClaudeMessage(msg);
      if (converted) {
        // Handle array of messages (multiple tool results)
        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  // Fix missing tool responses - OpenAI requires every tool_call to have a response
  fixMissingToolResponses(result.messages);

  // Tools
  if (req.tools && Array.isArray(req.tools)) {
    result.tools = req.tools.map((tool: ClaudeTool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: String(tool.description || ""),
        parameters: tool.input_schema || { type: "object", properties: {} },
      },
    }));
  }

  // Tool choice
  if (req.tool_choice) {
    result.tool_choice = convertToolChoice(req.tool_choice);
  }

  return result;
}

// Fix missing tool responses - add empty responses for tool_calls without responses
function fixMissingToolResponses(messages: unknown[]) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as OpenAIToolMessage;
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const toolCallIds = msg.tool_calls.map((tc: { id?: unknown }) => tc.id);

      // Collect all tool response IDs that IMMEDIATELY follow this assistant message
      const respondedIds = new Set<unknown>();
      let insertPosition = i + 1;
      for (let j = i + 1; j < messages.length; j++) {
        const nextMsg = messages[j] as OpenAIToolMessage;
        if (nextMsg.role === "tool" && nextMsg.tool_call_id) {
          respondedIds.add(nextMsg.tool_call_id);
          insertPosition = j + 1;
        } else {
          break;
        }
      }

      // Find missing responses and insert them
      const missingIds = toolCallIds.filter((id: unknown) => !respondedIds.has(id));

      if (missingIds.length > 0) {
        const missingResponses = missingIds.map((id: unknown) => ({
          role: "tool",
          tool_call_id: id,
          content: "[No response received]",
        }));
        messages.splice(insertPosition, 0, ...missingResponses);
        i = insertPosition + missingResponses.length - 1;
      }
    }
  }
}

// Convert single Claude message - returns single message or array of messages
function convertClaudeMessage(msg: ClaudeMessage) {
  const role = msg.role === "user" || msg.role === "tool" ? "user" : "assistant";

  // Simple string content
  if (typeof msg.content === "string") {
    return { role, content: msg.content };
  }

  // Array content
  if (Array.isArray(msg.content)) {
    const parts: ClaudePart[] = [];
    const toolCalls: unknown[] = [];
    const toolResults: unknown[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          parts.push({ type: "text", text: block.text });
          break;

        case "image":
          if (block.source?.type === "base64") {
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            });
          }
          break;

        case "tool_use":
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          });
          break;

        case "tool_result": {
          let resultContent = "";
          if (typeof block.content === "string") {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            resultContent =
              block.content
                .filter((c: ClaudePart) => c.type === "text")
                .map((c: ClaudePart) => c.text)
                .join("\n") || JSON.stringify(block.content);
          } else if (block.content) {
            resultContent = JSON.stringify(block.content);
          }

          toolResults.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: resultContent,
          });
          break;
        }
      }
    }

    // If has tool results, return array of tool messages
    if (toolResults.length > 0) {
      if (parts.length > 0) {
        const textContent =
          parts.length === 1 && (parts[0] as ClaudePart).type === "text"
            ? (parts[0] as ClaudePart).text
            : parts;
        return [...toolResults, { role: "user", content: textContent }];
      }
      return toolResults;
    }

    // If has tool calls, return assistant message with tool_calls
    if (toolCalls.length > 0) {
      const result: Record<string, unknown> = { role: "assistant" };
      if (parts.length > 0) {
        result.content =
          parts.length === 1 && (parts[0] as ClaudePart).type === "text"
            ? (parts[0] as ClaudePart).text
            : parts;
      }
      result.tool_calls = toolCalls;
      return result;
    }

    if (parts.length > 0) {
      const allText = parts.every((p: ClaudePart) => p.type === "text");
      return {
        role,
        content: allText ? parts.map((p: ClaudePart) => p.text).join("\n") : parts,
      };
    }

    // Empty content array
    if (msg.content.length === 0) {
      return { role, content: "" };
    }
  }

  return null;
}

// Convert tool choice
function convertToolChoice(choice: unknown) {
  if (!choice) return "auto";
  if (typeof choice === "string") return choice;

  switch ((choice as ClaudeToolChoice).type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return { type: "function", function: { name: (choice as ClaudeToolChoice).name } };
    default:
      return "auto";
  }
}

// Register
register(FORMATS.CLAUDE, FORMATS.OPENAI, claudeToOpenAIRequest, null);
