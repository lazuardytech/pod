// HuggingFace Inference API — returns binary image
import { type ImageRequestBody, type ProviderCredentials, nowSec } from "./_base.js";

const BASE_URL = "https://api-inference.huggingface.co/models";

export default {
  buildUrl: (model: string) => `${BASE_URL}/${model}`,
  buildHeaders: (creds: ProviderCredentials) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },
  buildBody: (_model: string, body: ImageRequestBody) => ({ inputs: body.prompt }),
  // HF returns raw image bytes — convert to b64_json
  async parseResponse(response: Response) {
    const buf = await response.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { created: nowSec(), data: [{ b64_json: base64 }] };
  },
  normalize: (responseBody: unknown) => responseBody,
};
