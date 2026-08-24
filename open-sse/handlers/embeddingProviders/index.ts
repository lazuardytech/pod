// Embeddings provider adapter registry

import gemini from "./gemini.ts";
import createOpenAIEmbeddingAdapter from "./openai.ts";
import openaiCompatNode from "./openaiCompatNode.ts";

const OPENAI_COMPAT_PROVIDERS = [
  "openai",
  "openrouter",
  "mistral",
  "voyage-ai",
  "fireworks",
  "together",
  "nebius",
  "github",
  "nvidia",
  "jina-ai",
];

type EmbeddingAdapter = {
  buildBody: (...args: unknown[]) => unknown;
  buildHeaders: (...args: unknown[]) => HeadersInit;
  buildUrl: (...args: unknown[]) => string;
  normalize: (...args: unknown[]) => Record<string, unknown>;
};

const ADAPTERS = {
  ...Object.fromEntries(
    OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)]),
  ),
  gemini,
  google_ai_studio: gemini,
} as unknown as Record<string, EmbeddingAdapter>;

export function getEmbeddingAdapter(provider: string): EmbeddingAdapter | null {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode as unknown as EmbeddingAdapter;
  }
  return null;
}
