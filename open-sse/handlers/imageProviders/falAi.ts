// Fal.ai — async submit + queue polling
import {
  type ImageProviderHeaders,
  type ImageRequestBody,
  type JsonObject,
  type PollingParseContext,
  type ProviderCredentials,
  nowSec,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  sizeToAspectRatio,
  sleep,
} from "./_base.js";

const BASE_URL = "https://queue.fal.run";

export default {
  async: true,
  buildUrl: (model: string) => `${BASE_URL}/${model}`,
  buildHeaders: (creds: ProviderCredentials) => {
    const key = creds?.apiKey || creds?.accessToken;
    return { "Content-Type": "application/json", Authorization: `Key ${key}` };
  },
  buildBody: (_model: string, body: ImageRequestBody) => {
    const req: JsonObject = { prompt: body.prompt, num_images: body.n || 1 };
    if (body.size) req.image_size = sizeToAspectRatio(body.size);
    if (body.image) req.image_url = body.image;
    return req;
  },
  async parseResponse(response: Response, { headers }: PollingParseContext) {
    const { status_url, response_url } = (await response.json()) as {
      response_url: string;
      status_url: string;
    };
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(status_url, { headers: headers as ImageProviderHeaders });
      if (!r.ok) throw new Error(`Fal status ${r.status}`);
      const s = (await r.json()) as { error?: string; status?: string };
      if (s.status === "COMPLETED") {
        const fr = await fetch(response_url, { headers: headers as ImageProviderHeaders });
        return await fr.json();
      }
      if (s.status === "FAILED") throw new Error(s.error || "Fal generation failed");
    }
    throw new Error("Fal polling timeout");
  },
  normalize: (responseBody: { image?: { url?: string } | string; images?: ({ url?: string } | string)[] }) => {
    const images = Array.isArray(responseBody.images)
      ? responseBody.images
      : responseBody.image
        ? [responseBody.image]
        : [];
    return {
      created: nowSec(),
      data: images.map((img) => ({ url: typeof img === "string" ? img : img.url || img })),
    };
  },
};
