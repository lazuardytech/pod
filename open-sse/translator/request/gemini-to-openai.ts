import { FORMATS } from "../formats.ts";
import { adjustMaxTokens } from "../helpers/maxTokensHelper.ts";
import { register } from "../registry.ts";

type GeminiTextPart = { type?: unknown; text?: unknown };
type GeminiPart = {
  text?: unknown;
  inlineData?: { mimeType?: unknown; data?: unknown };
  functionCall?: { name?: unknown; args?: unknown };
  functionResponse?: {
    id?: unknown;
    name?: unknown;
    response?: { result?: unknown };
  };
};
type GeminiContent = {
  role?: unknown;
  parts?: GeminiPart[];
};
type GeminiSystemInstruction = string | { parts?: GeminiPart[] };
type GeminiTool = {
  functionDeclarations?: {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
  }[];
};
type GeminiRequestBody = {
  generationConfig?: {
    maxOutputTokens?: unknown;
    temperature?: unknown;
    topP?: unknown;
  };
  systemInstruction?: GeminiSystemInstruction;
  contents?: GeminiContent[];
  tools?: GeminiTool[];
};

// Convert Gemini request to OpenAI format
export function geminiToOpenAIRequest(model: unknown, body: unknown, stream: unknown) {
  const req = body as GeminiRequestBody; // trusted: registry passes Gemini payloads
  const result: Record<string, unknown> & { messages: unknown[]; tools?: unknown[] } = {
    model: model,
    messages: [] as unknown[],
    stream: stream,
  };

  // Generation config
  if (req.generationConfig) {
    const config = req.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: req.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (req.systemInstruction) {
    const systemText = extractGeminiText(req.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: "system",
        content: systemText,
      });
    }
  }

  // Convert contents to messages
  if (req.contents && Array.isArray(req.contents)) {
    for (const content of req.contents) {
      const converted = convertGeminiContent(content);
      if (converted) {
        result.messages.push(converted);
      }
    }
  }

  // Tools
  if (req.tools && Array.isArray(req.tools)) {
    result.tools = [];
    for (const tool of req.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: "function",
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parameters || { type: "object", properties: {} },
            },
          });
        }
      }
    }
  }

  return result;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content: GeminiContent) {
  const role = content.role === "user" ? "user" : "assistant";

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts: unknown[] = [];
  const toolCalls: unknown[] = [];

  for (const part of content.parts) {
    if (part.text !== undefined) {
      parts.push({ type: "text", text: part.text });
    }

    if (part.inlineData) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
      });
    }

    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      });
    }

    if (part.functionResponse) {
      return {
        role: "tool",
        tool_call_id: part.functionResponse.id || part.functionResponse.name,
        content: JSON.stringify(
          part.functionResponse.response?.result || part.functionResponse.response || {},
        ),
      };
    }
  }

  if (toolCalls.length > 0) {
    const result: Record<string, unknown> = { role: "assistant" };
    if (parts.length > 0) {
      result.content = parts.length === 1 ? (parts[0] as GeminiTextPart).text : parts;
    }
    result.tool_calls = toolCalls;
    return result;
  }

  if (parts.length > 0) {
    return {
      role,
      content:
        parts.length === 1 && (parts[0] as GeminiTextPart).type === "text"
          ? (parts[0] as GeminiTextPart).text
          : parts,
    };
  }

  return null;
}

// Extract text from Gemini content
function extractGeminiText(content: GeminiSystemInstruction) {
  if (typeof content === "string") return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map((p: GeminiPart) => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
