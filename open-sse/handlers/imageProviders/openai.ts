// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)

import type {
  ImageProviderHeaders,
  ImageRequestBody,
  JsonObject,
  ProviderCredentials,
} from "./_base.js";

const ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/images/generations",
  minimax: "https://api.minimaxi.com/v1/images/generations",
  openrouter: "https://openrouter.ai/api/v1/images/generations",
  recraft: "https://external.api.recraft.ai/v1/images/generations",
};

export default function createOpenAIAdapter(providerId: string) {
  return {
    buildUrl: () => ENDPOINTS[providerId],
    buildHeaders: (creds: ProviderCredentials) => {
      const headers: ImageProviderHeaders = { "Content-Type": "application/json" };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      if (providerId === "openrouter") {
        headers["HTTP-Referer"] = "https://endpoint-proxy.local";
        headers["X-Title"] = "Endpoint Proxy";
      }
      return headers;
    },
    buildBody: (model: string, body: ImageRequestBody) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      const req: JsonObject = { model, prompt, n, size };
      if (quality) req.quality = quality;
      if (style) req.style = style;
      if (response_format) req.response_format = response_format;
      return req;
    },
    normalize: (responseBody: unknown) => responseBody,
  };
}
