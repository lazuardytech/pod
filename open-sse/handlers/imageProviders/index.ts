// Image provider adapter registry

import type { ImageProviderAdapter } from "./_base.ts";
import blackForestLabs from "./blackForestLabs.ts";
import cloudflareAi from "./cloudflareAi.ts";
import codex from "./codex.ts";
import comfyui from "./comfyui.ts";
import falAi from "./falAi.ts";
import gemini from "./gemini.ts";
import huggingface from "./huggingface.ts";
import nanobanana from "./nanobanana.ts";
import createOpenAIAdapter from "./openai.ts";
import runwayml from "./runwayml.ts";
import sdwebui from "./sdwebui.ts";
import stabilityAi from "./stabilityAi.ts";

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
