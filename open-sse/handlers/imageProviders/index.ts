// Image provider adapter registry

import type { ImageProviderAdapter } from "./_base.js";
import blackForestLabs from "./blackForestLabs.js";
import cloudflareAi from "./cloudflareAi.js";
import codex from "./codex.js";
import comfyui from "./comfyui.js";
import falAi from "./falAi.js";
import gemini from "./gemini.js";
import huggingface from "./huggingface.js";
import nanobanana from "./nanobanana.js";
import createOpenAIAdapter from "./openai.js";
import runwayml from "./runwayml.js";
import sdwebui from "./sdwebui.js";
import stabilityAi from "./stabilityAi.js";

const ADAPTERS = {
  openai: createOpenAIAdapter("openai"),
  minimax: createOpenAIAdapter("minimax"),
  openrouter: createOpenAIAdapter("openrouter"),
  recraft: createOpenAIAdapter("recraft"),
  gemini,
  codex,
  sdwebui,
  comfyui,
  huggingface,
  nanobanana,
  "fal-ai": falAi,
  "stability-ai": stabilityAi,
  "black-forest-labs": blackForestLabs,
  runwayml,
  "cloudflare-ai": cloudflareAi,
} as unknown as Record<string, ImageProviderAdapter>;

export function getImageAdapter(provider: string) {
  return ADAPTERS[provider] || null;
}

export function isImageProvider(provider: string) {
  return provider in ADAPTERS;
}
