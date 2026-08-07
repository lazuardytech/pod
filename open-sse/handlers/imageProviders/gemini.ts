// Google Gemini adapter (Nano Banana models)
import { type ImageRequestBody, type ProviderCredentials, nowSec } from "./_base.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  buildUrl: (model: string, creds: ProviderCredentials) => {
    const apiKey = creds?.apiKey || creds?.accessToken;
    const modelId = model.replace(/^models\//, "");
    return `${BASE_URL}/${modelId}:generateContent?key=${encodeURIComponent(String(apiKey))}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model: string, body: ImageRequestBody) => ({
    contents: [{ parts: [{ text: body.prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  }),
  normalize: (
    responseBody: { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] },
    prompt: string,
  ) => {
    const parts = responseBody.candidates?.[0]?.content?.parts || [];
    const images = parts
      .filter((p) => p.inlineData?.data)
      .map((p) => ({ b64_json: p.inlineData?.data }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
