// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.ts and ponytail.ts.

import { FORMATS } from "../translator/formats.ts";

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

export function injectSystemPrompt(
  body: JsonRecord | null | undefined,
  format: string,
  prompt: string | null | undefined,
): void {
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      injectGeminiSystem(body, prompt);
      return;
    default:
      injectMessagesSystem(body, prompt);
  }
}

function injectMessagesSystem(body: JsonRecord, prompt: string) {
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
    msg.content.push({ type: "input_text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

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
