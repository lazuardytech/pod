// OpenAI-compatible embeddings adapter (most providers)
import { type EmbeddingCredentials, bearerAuth } from "./_base.ts";

const ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/embeddings",
  openrouter: "https://openrouter.ai/api/v1/embeddings",
  mistral: "https://api.mistral.ai/v1/embeddings",
  "voyage-ai": "https://api.voyageai.com/v1/embeddings",
  fireworks: "https://api.fireworks.ai/inference/v1/embeddings",
  together: "https://api.together.xyz/v1/embeddings",
  nebius: "https://api.tokenfactory.nebius.com/v1/embeddings",
  github: "https://models.github.ai/inference/embeddings",
  nvidia: "https://integrate.api.nvidia.com/v1/embeddings",
  "jina-ai": "https://api.jina.ai/v1/embeddings",
};

type EmbeddingBodyParams = {
  dimensions?: unknown;
  encoding_format?: string;
  input: string | string[];
};

export default function createOpenAIEmbeddingAdapter(providerId: string) {
  return {
    buildUrl: () => ENDPOINTS[providerId],
    buildHeaders: (creds: EmbeddingCredentials) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...bearerAuth(creds),
      };
      if (providerId === "openrouter") {
        headers["HTTP-Referer"] = "https://endpoint-proxy.local";
        headers["X-Title"] = "Endpoint Proxy";
      }
      return headers;
    },
    buildBody: (model: string, { input, encoding_format, dimensions }: EmbeddingBodyParams) => {
      const body: Record<string, unknown> = { model, input };
      if (encoding_format) body.encoding_format = encoding_format;
      if (dimensions !== null && dimensions !== undefined && dimensions !== "") {
        const dim = Number(dimensions);
        if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
      }
      return body;
    },
    normalize: (responseBody: unknown) => responseBody,
  };
}
