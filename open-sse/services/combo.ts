/**
 * Shared combo (model combo) handling with fallback support
 */

import { getCapabilitiesForModel } from "../providers/capabilities.ts";
import { unavailableResponse } from "../utils/error.ts";
import { checkFallbackError, formatRetryAfter } from "./accountFallback.ts";

const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

type JsonRecord = Record<string, unknown>;

type ComboLogger = {
  info: (scope: string, message: string, meta?: JsonRecord) => void;
  warn: (scope: string, message: string, meta?: JsonRecord) => void;
};

type ComboEntry = {
  name?: string;
  models?: string[];
  systemPrompt?: string | null;
};

type CombosData = ComboEntry[] | { combos?: ComboEntry[] } | null | undefined;

type ComboRotationState = { index: number; consecutiveUseCount: number };

type TextPart = { text?: string; [key: string]: unknown };

type SystemInstruction = {
  role?: string;
  parts?: TextPart[];
  [key: string]: unknown;
};

/** Mutable request body shapes handled by combo system-prompt injection. */
export type ComboRequestBody = {
  request?: {
    contents?: unknown;
    systemInstruction?: SystemInstruction;
    [key: string]: unknown;
  };
  contents?: unknown;
  systemInstruction?: SystemInstruction;
  input?: unknown;
  messages?: unknown;
  instructions?: string;
  system?: unknown;
  anthropic_version?: unknown;
  [key: string]: unknown;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asComboList(combosData: CombosData): ComboEntry[] {
  if (Array.isArray(combosData)) return combosData;
  if (combosData && typeof combosData === "object" && Array.isArray(combosData.combos)) {
    return combosData.combos;
  }
  return [];
}

/**
 * Track rotation state per combo (for round-robin strategy)
 *
 * SAFETY: All access to this map happens in `getRotatedModels()` which is
 * purely synchronous (no `await`). Node.js single-threaded event loop
 * guarantees no interleaving between read and write — each call completes
 * atomically within one JS tick. No mutex needed.
 */
const comboRotationState = new Map<string, ComboRotationState | number>();

export interface ComboChatParams {
  body: JsonRecord;
  models: string[];
  handleSingleModel: (body: JsonRecord, model: string, isPanel?: boolean) => Promise<Response>;
  log: ComboLogger;
  comboName?: string;
  comboStrategy?: string;
  comboStickyLimit?: number | string;
  autoSwitch?: boolean;
  judgeModel?: string;
  tuning?: {
    minPanel?: number;
    stragglerGraceMs?: number;
    panelHardTimeoutMs?: number;
  };
}

/** TTS/image/search/fetch cannot panel+judge — fusion becomes sequential fallback. */
export function coerceNonChatComboStrategy(strategy: string | undefined): string {
  return strategy === "fusion" ? "fallback" : strategy || "fallback";
}

function normalizeStickyLimit(stickyLimit: unknown): number {
  const parsed = Number.parseInt(String(stickyLimit), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models: string[], currentIndex: number): string[] {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    if (moved !== undefined) rotatedModels.push(moved);
  }
  return rotatedModels;
}

function trailingUserItems<T extends { role?: string }>(arr: T[] | unknown): T[] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r: unknown) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

export function reorderByCapabilities(
  models: string[],
  required: Set<string> | null | undefined,
): string[] {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1)
    return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m: string) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model) as unknown as Record<
      string,
      boolean | number | undefined
    >;
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  return models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

export function detectRequiredCapabilities(body: JsonRecord | null | undefined): Set<string> {
  const required = new Set<string>();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime: unknown) => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b: unknown) => {
    if (!b || typeof b !== "object") return;
    const rec = b as JsonRecord;
    const t = rec.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      let fmime: string | null = null;
      const inputAudio = rec.input_audio as { format?: string } | undefined;
      const file = rec.file as { file_data?: string } | undefined;
      const source = rec.source as { media_type?: string; data?: string } | undefined;
      if (inputAudio?.format) fmime = `audio/${inputAudio.format}`;
      else if (file?.file_data) fmime = String(file.file_data).match(/^data:([^;,]+)/)?.[1] ?? null;
      else if (source?.media_type) fmime = source.media_type;
      else if (source?.data) fmime = String(source.data).match(/^data:([^;,]+)/)?.[1] ?? null;
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    const inlineData = rec.inlineData as { mimeType?: string } | undefined;
    const fileData = rec.fileData as { mimeType?: string } | undefined;
    addByMime(inlineData?.mimeType || fileData?.mimeType);
  };

  const scanContent = (content: unknown) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  const scanMessage = (m: unknown) => {
    if (!m || typeof m !== "object") return;
    const rec = m as JsonRecord;

    if (Array.isArray(rec.images) && rec.images.length > 0) required.add("vision");

    const attachments = rec.experimental_attachments || rec.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att || typeof att !== "object") continue;
        const a = att as { contentType?: string; mediaType?: string; url?: string; data?: unknown };
        const mime =
          a.contentType ||
          a.mediaType ||
          (typeof a.url === "string" ? a.url.match(/^data:([^;,]+)/)?.[1] : undefined);
        if (mime) addByMime(mime);
        else if (a.url || a.data) required.add("vision");
      }
    }

    if (rec.image_url || rec.image) required.add("vision");
    if (rec.audio_url || rec.audio) required.add("audioInput");

    scanContent(rec.content);

    if (typeof rec.content === "string") {
      if (rec.content.includes("data:image/")) required.add("vision");
      else if (rec.content.includes("data:audio/")) required.add("audioInput");
      else if (rec.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  for (const m of trailingUserItems(body.messages as { role?: string }[])) scanMessage(m);
  for (const it of trailingUserItems(body.input as { role?: string; content?: unknown }[])) {
    scanContent((it as { content?: unknown }).content);
  }
  const contents = body.contents || (body.request as { contents?: unknown } | undefined)?.contents;
  for (const c of trailingUserItems(contents as { role?: string; parts?: unknown }[])) {
    scanContent((c as { parts?: unknown }).parts);
  }

  return required;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(
  models: string[],
  comboName: string | undefined,
  strategy: string | undefined,
  stickyLimit: number | string = 1,
): string[] {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state: ComboRotationState =
    typeof existingState === "number"
      ? { index: existingState, consecutiveUseCount: 0 }
      : existingState || { index: 0, consecutiveUseCount: 0 };

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName?: string) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr: string, combosData: CombosData): string[] | null {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;

  const combos = asComboList(combosData);

  const combo = combos.find((c) => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Get full combo entry (models + systemPrompt) from combos data
 * @param {string} modelStr
 * @param {Array|Object} combosData
 * @returns {{models: string[], systemPrompt: string|null}|null}
 */
export function getComboEntryFromData(
  modelStr: string,
  combosData: CombosData,
): { models: string[]; systemPrompt: string | null } | null {
  if (modelStr.includes("/")) return null;
  const combos = asComboList(combosData);
  const combo = combos.find((c) => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return { models: combo.models, systemPrompt: combo.systemPrompt || null };
  }
  return null;
}

/**
 * Inject a combo-level system prompt into the request body.
 * Mutates and returns the body. Detects shape (OpenAI / Claude / Gemini /
 * OpenAI Responses / Antigravity) and prepends the prompt so it takes priority.
 * @param {Object} body
 * @param {string} systemPrompt
 * @returns {Object}
 */
export function injectComboSystemPrompt(
  body: ComboRequestBody | null | undefined,
  systemPrompt: unknown,
): ComboRequestBody | null | undefined {
  if (!body || typeof systemPrompt !== "string" || !systemPrompt.trim()) return body;
  const prompt = systemPrompt;

  // Antigravity envelope: { request: { systemInstruction, contents, ... } }
  if (body.request && (body.request.contents || body.request.systemInstruction)) {
    const req = body.request;
    const existing = req.systemInstruction;
    const newPart: TextPart = { text: prompt };
    if (existing?.parts && Array.isArray(existing.parts)) {
      existing.parts.unshift(newPart);
    } else if (existing?.role || existing?.parts) {
      req.systemInstruction = {
        role: existing.role || "user",
        parts: [newPart, ...(existing.parts || [])],
      };
    } else {
      req.systemInstruction = { role: "user", parts: [newPart] };
    }
    return body;
  }

  // Gemini: { contents, systemInstruction? }
  if (Array.isArray(body.contents)) {
    const existing = body.systemInstruction;
    const newPart: TextPart = { text: prompt };
    if (existing?.parts && Array.isArray(existing.parts)) {
      existing.parts.unshift(newPart);
    } else {
      body.systemInstruction = { role: "user", parts: [newPart] };
    }
    return body;
  }

  // OpenAI Responses API: { input, instructions? }
  if (body.input !== undefined && body.messages === undefined) {
    if (Array.isArray(body.input)) {
      body.input.unshift({ role: "system", content: prompt });
    } else {
      body.instructions = body.instructions ? `${prompt}\n\n${body.instructions}` : prompt;
    }
    return body;
  }

  // Claude: { messages, system? }
  if (Array.isArray(body.messages) && (body.system !== undefined || body.anthropic_version)) {
    if (typeof body.system === "string") {
      body.system = `${prompt}\n\n${body.system}`;
    } else if (Array.isArray(body.system)) {
      body.system = [{ type: "text", text: prompt }, ...body.system];
    } else {
      body.system = prompt;
    }
    return body;
  }

  // OpenAI chat completions (default): { messages }
  if (Array.isArray(body.messages)) {
    body.messages = [{ role: "system", content: prompt }, ...body.messages];
    return body;
  }

  return body;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({
  body,
  models,
  handleSingleModel,
  log,
  comboName,
  comboStrategy,
  comboStickyLimit = 1,
  autoSwitch = true,
  judgeModel,
  tuning,
}: ComboChatParams): Promise<Response> {
  if (comboStrategy === "fusion") {
    // Inline import: fusion.ts imports detectRequiredCapabilities from this module.
    const { handleFusionChat } = await import("./fusion.ts");
    return handleFusionChat({
      body,
      models,
      handleSingleModel,
      log,
      comboName,
      judgeModel,
      tuning,
    });
  }

  // Apply rotation strategy if enabled
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }

  let lastError: string | null = null;
  let earliestRetryAfter: string | null = null;
  let lastStatus: number | null = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i]!;
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);

      // Success (2xx) - return response
      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      // Extract error info from response
      let errorText: unknown = result.statusText || "";
      let retryAfter: string | null = null;
      try {
        const errorBodyUnknown: unknown = await result.clone().json();
        const errorBody =
          errorBodyUnknown && typeof errorBodyUnknown === "object"
            ? (errorBodyUnknown as JsonRecord)
            : {};
        const errField = errorBody.error;
        const errMessage =
          errField && typeof errField === "object" && errField !== null
            ? (errField as JsonRecord).message
            : undefined;
        errorText = errMessage || errField || errorBody.message || errorText;
        retryAfter = typeof errorBody.retryAfter === "string" ? errorBody.retryAfter : null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (
        retryAfter &&
        (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))
      ) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      let errorTextStr: string;
      if (typeof errorText === "string") {
        errorTextStr = errorText;
      } else {
        try {
          errorTextStr = JSON.stringify(errorText);
        } catch {
          errorTextStr = String(errorText);
        }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorTextStr);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (
        cooldownMs &&
        cooldownMs > 0 &&
        cooldownMs <= 5000 &&
        (result.status === 503 || result.status === 502 || result.status === 504)
      ) {
        log.info(
          "COMBO",
          `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`,
        );
        await new Promise<void>((r) => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorTextStr || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error: unknown) {
      // Catch unexpected exceptions to ensure fallback continues
      // Log full error internally but don't expose raw stack/message to clients
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, {
        error: errorMessage(error),
      });
      lastError = "Model request failed";
      if (!lastStatus) lastStatus = 500;
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : lastStatus || 503;
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Override the `model` field in a combo response.
 * Handles both non-streaming (JSON) and streaming (SSE) responses.
 * @param {Response} response
 * @param {string} modelId
 * @returns {Response}
 */
export async function overrideResponseModelId(
  response: Response,
  modelId: string | null | undefined,
): Promise<Response> {
  if (!modelId || !response) return response;

  const contentType = response.headers.get("content-type") || "";

  // SSE streaming — rewrite each `data:` line that contains a `"model"` field
  if (contentType.includes("text/event-stream")) {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        const rewritten = text
          .split("\n")
          .map((line) => {
            if (!line.startsWith("data:")) return line;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return line;
            try {
              const obj: unknown = JSON.parse(payload);
              if (obj && typeof obj === "object" && "model" in obj) {
                (obj as JsonRecord).model = modelId;
              }
              return `data: ${JSON.stringify(obj)}`;
            } catch {
              // Malformed SSE data should pass through unchanged.
              return line;
            }
          })
          .join("\n");
        controller.enqueue(new TextEncoder().encode(rewritten));
      },
    });
    response.body!.pipeTo(writable).catch(() => {
      // Client disconnect or upstream cancellation; response body cleanup is best effort.
    });
    const headers = new Headers(response.headers);
    return new Response(readable, { status: response.status, headers });
  }

  // Non-streaming JSON
  try {
    const bodyUnknown: unknown = await response.json();
    const body =
      bodyUnknown && typeof bodyUnknown === "object" ? (bodyUnknown as JsonRecord) : bodyUnknown;
    if (body && typeof body === "object" && "model" in body) body.model = modelId;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { status: response.status, headers });
  } catch {
    // Preserve original response when non-streaming body cannot be parsed.
    return response;
  }
}
