// @ts-nocheck
import { normalizeThinkingConfig } from "../services/provider.js";
import { cloakClaudeTools } from "../utils/claudeCloaking.js";
import { FORMATS } from "./formats.js";
import { prepareClaudeRequest } from "./helpers/claudeHelper.js";
import { filterToOpenAIFormat } from "./helpers/openaiHelper.js";
import { ensureToolCallIds, fixMissingToolResponses } from "./helpers/toolCallHelper.js";
import type {
  TranslatedResponseResults,
  TranslatorCredentials,
  TranslatorRequestPayload,
  TranslatorResponseChunk,
  TranslatorResponseResult,
  TranslatorState,
} from "./registry.js";
import {
  getRegisteredRequestTranslatorKeys,
  getRegisteredResponseTranslatorKeys,
  register,
  requestRegistry,
  responseRegistry,
} from "./registry.js";
// Side-effect: register all translators (via registry.ts — no circular init).
import "./loaders.js";

export { getRegisteredRequestTranslatorKeys, getRegisteredResponseTranslatorKeys, register };

type RequestPipelineBody = TranslatorRequestPayload & {
  _toolNameMap?: Map<string, string>;
};

type RequestLogger = {
  logOpenAIRequest?: (body: TranslatorRequestPayload) => void;
};

function asRequestBody(body: TranslatorRequestPayload): RequestPipelineBody {
  return body as RequestPipelineBody;
}

function asTranslatedResponseResults(
  converted: Exclude<TranslatorResponseResult, null | undefined>,
): TranslatedResponseResults {
  return (Array.isArray(converted) ? converted : [converted]) as TranslatedResponseResults;
}

function ensureInitialized(): void {
  if (requestRegistry.size === 0 || responseRegistry.size === 0) {
    throw new Error("Translator registry is empty; loader side-effect imports did not run.");
  }
}

// Strip specific content types from messages (explicit opt-in via strip[] in PROVIDER_MODELS)
function stripContentTypes(body: unknown, stripList: unknown = []) {
  if (!stripList.length || !body.messages || !Array.isArray(body.messages)) return;
  const imageTypes = new Set(["image_url", "image"]);
  const audioTypes = new Set(["audio_url", "input_audio"]);
  const shouldStrip = (type: unknown) => {
    if (imageTypes.has(type)) return stripList.includes("image");
    if (audioTypes.has(type)) return stripList.includes("audio");
    return false;
  };
  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.filter((part: unknown) => !shouldStrip(part.type));
    if (msg.content.length === 0) msg.content = "";
  }
}

// Normalize 'developer' role to 'system' for providers that don't accept it
// (DeepSeek, Groq, and other OpenAI-format providers)
function normalizeDeveloperRole(body: unknown) {
  if (!body.messages || !Array.isArray(body.messages)) return;
  for (const msg of body.messages) {
    if (msg.role === "developer") {
      msg.role = "system";
    }
  }
}

// Translate request: source -> openai -> target
export function translateRequest(
  sourceFormat: string,
  targetFormat: string,
  model: string,
  body: TranslatorRequestPayload,
  stream: boolean = true,
  credentials: TranslatorCredentials = null,
  provider: string | null = null,
  reqLogger: RequestLogger | null = null,
  stripList: readonly unknown[] = [],
  connectionId: string | null = null,
  clientTool: unknown = null,
): TranslatorRequestPayload {
  ensureInitialized();
  void clientTool;
  let result = asRequestBody(body);

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
        result = asRequestBody(toOpenAI(model, result, stream, credentials));
        // Log OpenAI intermediate format
        reqLogger?.logOpenAIRequest?.(result);
      }
    }

    // Step 2: openai -> target (if target is not openai)
    if (targetFormat !== FORMATS.OPENAI) {
      const fromOpenAI = requestRegistry.get(`${FORMATS.OPENAI}:${targetFormat}`);
      if (fromOpenAI) {
        result = asRequestBody(fromOpenAI(model, result, stream, credentials));
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
      const { body: cloakedBody, toolNameMap } = cloakClaudeTools(result);
      result = asRequestBody(cloakedBody);
      const typedToolNameMap =
        toolNameMap instanceof Map ? (toolNameMap as Map<string, string>) : null;
      if (typedToolNameMap && typedToolNameMap.size > 0) {
        result._toolNameMap = typedToolNameMap;
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
export function translateResponse(
  targetFormat: string,
  sourceFormat: string,
  chunk: TranslatorResponseChunk,
  state: TranslatorState,
): TranslatedResponseResults {
  ensureInitialized();
  // If same format, return as-is
  if (sourceFormat === targetFormat) {
    return [chunk] as TranslatedResponseResults;
  }

  let results: TranslatedResponseResults = [chunk] as TranslatedResponseResults;
  let openaiResults: TranslatorResponseChunk[] | null = null; // Store OpenAI intermediate results

  // Step 1: target -> openai (if target is not openai)
  if (targetFormat !== FORMATS.OPENAI) {
    const toOpenAI = responseRegistry.get(`${targetFormat}:${FORMATS.OPENAI}`);
    if (toOpenAI) {
      const converted = toOpenAI(chunk, state);
      if (converted) {
        results = asTranslatedResponseResults(converted);
        openaiResults = results; // Store OpenAI intermediate
      } else {
        results = [] as TranslatedResponseResults;
      }
    }
  }

  // Step 2: openai -> source (if source is not openai)
  if (sourceFormat !== FORMATS.OPENAI) {
    const fromOpenAI = responseRegistry.get(`${FORMATS.OPENAI}:${sourceFormat}`);
    if (fromOpenAI) {
      const finalResults = [] as TranslatedResponseResults;
      for (const r of results) {
        const converted = fromOpenAI(r, state);
        if (converted) {
          finalResults.push(...asTranslatedResponseResults(converted));
        }
      }
      results = finalResults;
    }
  }

  // Attach OpenAI intermediate results for logging
  if (openaiResults && sourceFormat !== FORMATS.OPENAI && targetFormat !== FORMATS.OPENAI) {
    results._openaiIntermediate = openaiResults;
  }

  return results;
}

// Check if translation needed
export function needsTranslation(sourceFormat: string, targetFormat: string): boolean {
  return sourceFormat !== targetFormat;
}

// Initialize state for streaming response based on format
export function initState(sourceFormat: string): TranslatorState {
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

export function initTranslators(): void {
  ensureInitialized();
}
