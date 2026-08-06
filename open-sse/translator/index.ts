import { normalizeThinkingConfig } from "../services/provider.js";
import { cloakClaudeTools } from "../utils/claudeCloaking.js";
import { FORMATS } from "./formats.js";
import { prepareClaudeRequest } from "./helpers/claudeHelper.js";
import { filterToOpenAIFormat } from "./helpers/openaiHelper.js";
import { ensureToolCallIds, fixMissingToolResponses } from "./helpers/toolCallHelper.js";
import { createRequire } from "node:module";
import {
  register,
  requestRegistry,
  responseRegistry,
} from "./registry.js";

export { register };

const require = createRequire(import.meta.url);


let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  require("./request/claude-to-openai.js");
  require("./request/openai-to-claude.js");
  require("./request/gemini-to-openai.js");
  require("./request/openai-to-gemini.js");
  require("./request/openai-to-vertex.js");
  require("./request/antigravity-to-openai.js");
  require("./request/openai-responses.js");
  require("./request/openai-to-kiro.js");
  require("./request/openai-to-cursor.js");
  require("./request/openai-to-ollama.js");
  require("./request/openai-to-commandcode.js");

  require("./response/claude-to-openai.js");
  require("./response/openai-to-claude.js");
  require("./response/gemini-to-openai.js");
  require("./response/openai-to-antigravity.js");
  require("./response/openai-responses.js");
  require("./response/kiro-to-openai.js");
  require("./response/cursor-to-openai.js");
  require("./response/ollama-to-openai.js");
  require("./response/commandcode-to-openai.js");
}

// Strip specific content types from messages (explicit opt-in via strip[] in PROVIDER_MODELS)
function stripContentTypes(body: any, stripList: any = []) {
  if (!stripList.length || !body.messages || !Array.isArray(body.messages)) return;
  const imageTypes = new Set(["image_url", "image"]);
  const audioTypes = new Set(["audio_url", "input_audio"]);
  const shouldStrip = (type: any) => {
    if (imageTypes.has(type)) return stripList.includes("image");
    if (audioTypes.has(type)) return stripList.includes("audio");
    return false;
  };
  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.filter((part: any) => !shouldStrip(part.type));
    if (msg.content.length === 0) msg.content = "";
  }
}

// Normalize 'developer' role to 'system' for providers that don't accept it
// (DeepSeek, Groq, and other OpenAI-format providers)
function normalizeDeveloperRole(body: any) {
  if (!body.messages || !Array.isArray(body.messages)) return;
  for (const msg of body.messages) {
    if (msg.role === "developer") {
      msg.role = "system";
    }
  }
}

// Translate request: source -> openai -> target
export function translateRequest(
  sourceFormat: any,
  targetFormat: any,
  model: any,
  body: any,
  stream: any = true,
  credentials: any = null,
  provider: any = null,
  reqLogger: any = null,
  stripList: any = [],
  connectionId: any = null,
  clientTool: any = null,
) {
  ensureInitialized();
  let result = body;

  // Strip explicit content types (opt-in via strip[] in PROVIDER_MODELS entry)
  stripContentTypes(result, stripList);

  // Normalize 'developer' role → 'system' for providers that don't accept it
  normalizeDeveloperRole(result);

  // Normalize thinking config: remove if lastMessage is not user
  normalizeThinkingConfig(result);

  // Always ensure tool_calls have id (some providers require it)
  ensureToolCallIds(result);

  // Fix missing tool responses (insert empty tool_result if needed)
  fixMissingToolResponses(result);

  // If same format, skip translation steps
  if (sourceFormat !== targetFormat) {
    // Step 1: source -> openai (if source is not openai)
    if (sourceFormat !== FORMATS.OPENAI) {
      const toOpenAI = requestRegistry.get(`${sourceFormat}:${FORMATS.OPENAI}`);
      if (toOpenAI) {
        result = toOpenAI(model, result, stream, credentials);
        // Log OpenAI intermediate format
        reqLogger?.logOpenAIRequest?.(result);
      }
    }

    // Step 2: openai -> target (if target is not openai)
    if (targetFormat !== FORMATS.OPENAI) {
      const fromOpenAI = requestRegistry.get(`${FORMATS.OPENAI}:${targetFormat}`);
      if (fromOpenAI) {
        result = fromOpenAI(model, result, stream, credentials);
      }
    }
  }

  // Always normalize to clean OpenAI format when target is OpenAI
  // This handles hybrid requests (e.g., OpenAI messages + Claude tools)
  if (targetFormat === FORMATS.OPENAI) {
    result = filterToOpenAIFormat(result);
  }

  // Final step: prepare request for Claude format endpoints
  if (targetFormat === FORMATS.CLAUDE) {
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    result = prepareClaudeRequest(result, provider, apiKey, connectionId);
  }

  // Claude cloaking: rename client tools with _cc suffix (anti-ban)
  // Only for claude provider (not anthropic-compatible-*) with OAuth token
  if (provider === "claude") {
    const apiKey = credentials?.accessToken || credentials?.apiKey || null;
    if (apiKey?.includes("sk-ant-oat")) {
      const { body: cloakedBody, toolNameMap } = cloakClaudeTools(result) as any;
      result = cloakedBody;
      if (toolNameMap?.size > 0) {
        result._toolNameMap = toolNameMap;
      }
    }
  }

  // Antigravity cloaking disabled
  // if (provider === FORMATS.ANTIGRAVITY && body.userAgent !== FORMATS.ANTIGRAVITY) {
  //   const { cloakedBody, toolNameMap } = AntigravityExecutor.cloakTools(result);
  //   result = cloakedBody;
  //   if (toolNameMap?.size > 0) {
  //     result._toolNameMap = toolNameMap;
  //   }
  // }

  return result;
}

// Translate response chunk: target -> openai -> source
export function translateResponse(targetFormat: any, sourceFormat: any, chunk: any, state: any) {
  ensureInitialized();
  // If same format, return as-is
  if (sourceFormat === targetFormat) {
    return [chunk];
  }

  let results: any[] = [chunk];
  let openaiResults: any[] | null = null; // Store OpenAI intermediate results

  // Step 1: target -> openai (if target is not openai)
  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = responseRegistry.get(`${targetFormat}:${FORMATS.OPENAI}`);
    if (toOpenAI) {
      results = [];
      const converted = toOpenAI(chunk, state);
      if (converted) {
        results = Array.isArray(converted) ? converted : [converted];
        openaiResults = results; // Store OpenAI intermediate
      }
    }
  }

  // Step 2: openai -> source (if source is not openai)
  if (sourceFormat !== FORMATS.OPENAI) {
    const fromOpenAI = responseRegistry.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults: any[] = [];
      for (const r of results) {
        const converted = fromOpenAI(r, state);
        if (converted) {
          finalResults.push(...(Array.isArray(converted) ? converted : [converted]));
        }
      }
      results = finalResults;
    }
  }

  // Attach OpenAI intermediate results for logging
  if (openaiResults && sourceFormat !== FORMATS.OPENAI && targetFormat !== FORMATS.OPENAI) {
    (results as any)._openaiIntermediate = openaiResults;
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat: any, targetFormat: any) {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat: any) {
  // Base state for all formats
  const base = {
    messageId: null,
    model: null,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    toolCalls: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    contentBlockIndex: -1,
  };

  // Add openai-responses specific fields
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return {
      ...base,
      seq: 0,
      responseId: `resp_${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      started: false,
      msgTextBuf: {},
      msgItemAdded: {},
      msgContentAdded: {},
      msgItemDone: {},
      reasoningId: "",
      reasoningIndex: -1,
      reasoningBuf: "",
      reasoningPartAdded: false,
      reasoningDone: false,
      inThinking: false,
      funcArgsBuf: {},
      funcNames: {},
      funcCallIds: {},
      funcArgsDone: {},
      funcItemDone: {},
      completedSent: false,
    };
  }

  return base;
}

export function initTranslators() {
  ensureInitialized();
}
