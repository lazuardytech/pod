// Black Forest Labs (FLUX) — async submit + polling_url
import {
  type ImageProviderHeaders,
  type ImageRequestBody,
  type JsonObject,
  type PollingParseContext,
  type ProviderCredentials,
  nowSec,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  sleep,
} from "./_base.js";

const BASE_URL = "https://api.bfl.ai/v1";

export default {
  async: true,
  buildUrl: (model: string) => `${BASE_URL}/${model}`,
  buildHeaders: (creds: ProviderCredentials) => {
    const key = creds?.apiKey || creds?.accessToken;
    return { "Content-Type": "application/json", "x-key": String(key) };
  },
  buildBody: (_model: string, body: ImageRequestBody) => {
    const req: JsonObject = { prompt: body.prompt };
    if (body.size) {
      const [w, h] = body.size.split("x").map(Number);
      if (w) req.width = w;
      if (h) req.height = h;
    }
    if (body.image) req.image_prompt = body.image;
    return req;
  },
  async parseResponse(response: Response, { headers }: PollingParseContext) {
    const data = (await response.json()) as { polling_url?: string };
    const pollingUrl = data.polling_url;
    if (!pollingUrl) throw new Error("BFL: no polling_url returned");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const typedHeaders = headers as ImageProviderHeaders;
      const r = await fetch(pollingUrl, {
        headers: { "x-key": String(typedHeaders["x-key"]), Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`BFL status ${r.status}`);
      const s = (await r.json()) as { error?: string; result?: unknown; status?: string };
      if (s.status === "Ready") return s;
      if (s.status === "Error" || s.status === "Failed")
        throw new Error(s.error || "BFL generation failed");
    }
    throw new Error("BFL polling timeout");
  },
  normalize: (responseBody: { result?: { sample?: string } }) => {
    const sample = responseBody.result?.sample;
    if (sample) return { created: nowSec(), data: [{ url: sample }] };
    return { created: nowSec(), data: [] };
  },
};
