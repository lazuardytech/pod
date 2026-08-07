// Custom/OpenAI-compatible embedding node adapter
import type { EmbeddingCredentials } from "./_base.js";
import createOpenAIEmbeddingAdapter from "./openai.js";

const base = createOpenAIEmbeddingAdapter("openai");

export default {
  ...base,
  buildUrl: (_model: string, creds: EmbeddingCredentials) => {
    const baseUrl =
      creds?.providerSpecificData?.baseUrl || creds?.baseUrl || "https://api.openai.com/v1";
    // ponytail: restore idempotent de-dup — old code stripped /embeddings before re-appending.
    return baseUrl.replace(/\/+$/, "").replace(/\/embeddings$/, "") + "/embeddings";
  },
};
