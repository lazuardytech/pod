// Caveman injector: appends a caveman-style instruction into the system message
// of the final request body, just before it is dispatched to the provider executor.
// Dispatches by format so it works for both translated and native-passthrough flows.

import { FORMATS } from "../translator/formats.js";
import { CAVEMAN_PROMPTS } from "./cavemanPrompts.js";

const SEP = "\n\n";

type JsonRecord = Record<string, unknown>;

type OpenAIMessage = {
  role?: string;
  content?: string | Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type ClaudeSystemBlock = {
  type?: string;
  text?: string;
  cache_control?: unknown;
  [key: string]: unknown;
};

type GeminiSystem = {
  parts?: Array<{ text?: string }>;
  [key: string]: unknown;
};

export function injectCaveman(body: JsonRecord | null | undefined, format: string, level: string) {
  const prompt = (CAVEMAN_PROMPTS as Record<string, string | undefined>)[level];
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (responses/codex/cursor/kiro/ollama)
      injectMessagesSystem(body, prompt);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (responses string)
function injectMessagesSystem(body: JsonRecord, prompt: string) {
  // OpenAI Responses API: top-level string field
  if (typeof body.instructions === "string") {
    body.instructions = body.instructions ? `${body.instructions}${SEP}${prompt}` : prompt;
    return;
  }

  const arr = Array.isArray(body.messages)
    ? (body.messages as OpenAIMessage[])
    : Array.isArray(body.input)
      ? (body.input as OpenAIMessage[])
      : null;
  if (!arr) return;

  const idx = arr.findIndex(
    (m: OpenAIMessage | null | undefined) => m && (m.role === "system" || m.role === "developer"),
  );
  if (idx >= 0) {
    const msg = arr[idx];
    if (msg) appendToOpenAIMessage(msg, prompt);
  } else {
    arr.unshift({ role: "system", content: prompt });
  }
}

function appendToOpenAIMessage(msg: OpenAIMessage, prompt: string) {
  if (typeof msg.content === "string") {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    // Responses-style array of parts {type:"input_text"|"text", text}
    msg.content.push({ type: "input_text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep caveman inside the cached prefix.
function injectClaudeSystem(body: JsonRecord, prompt: string) {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    const system = body.system as ClaudeSystemBlock[];
    const block: ClaudeSystemBlock = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = system.length - 1; i >= 0; i--) {
      if (system[i]?.cache_control) {
        lastCacheIdx = i;
        break;
      }
    }
    if (lastCacheIdx >= 0) {
      system.splice(lastCacheIdx, 0, block);
    } else {
      system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body: JsonRecord, prompt: string) {
  const target =
    body.request && typeof body.request === "object" ? (body.request as JsonRecord) : body;
  const useSnake = Object.hasOwn(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key] as GeminiSystem | undefined;
  if (sys && Array.isArray(sys.parts)) {
    sys.parts.push({ text: prompt });
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}
